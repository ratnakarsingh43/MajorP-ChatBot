import base64
import json
import io
import logging
from PIL import Image

from django.shortcuts import render
from django.http import JsonResponse, HttpResponseBadRequest
from django.views.decorators.http import require_POST
from django.conf import settings
from django.core.files.storage import default_storage
from django.core.files.base import ContentFile

# Fixed imports for the Gemini SDK
import google.generativeai as genai

logger = logging.getLogger(__name__)

# --- Global Initialization ---

# Initialize a chat session globally (for simple chat history)
chat_session = None

try:
    if getattr(settings, "GEMINI_API_KEY", None):
        genai.configure(api_key=settings.GEMINI_API_KEY)
        # Use gemini-2.5-flash for fast, multimodal conversations
        model = genai.GenerativeModel('gemini-2.5-flash')
        chat_session = model.start_chat(history=[])
        logger.info("Gemini client initialized successfully.")
    else:
        logger.warning("GEMINI_API_KEY not configured. Chat functionality will not work.")
except Exception as e:
    logger.exception("Error initializing Gemini client: %s", e)


# --- Helper constants / functions ---
MAX_UPLOAD_SIZE = getattr(settings, "CHAT_MAX_UPLOAD_SIZE", 5 * 1024 * 1024)  # 5 MB default
ALLOWED_IMAGE_PREFIX = "image/"


def _save_uploaded_file(uploaded_file):
    """
    Save an uploaded file to default storage under 'chat_uploads/' and return the public URL.
    """
    filename = uploaded_file.name
    storage_path = f"chat_uploads/{filename}"
    saved_path = default_storage.save(storage_path, ContentFile(uploaded_file.read()))
    return default_storage.url(saved_path)


def _open_pil_image_from_fileobj(file_obj):
    """
    Open a PIL Image from a file-like object (File uploaded via request.FILES).
    The caller should ensure file_obj is at position 0 or rewound as needed.
    """
    file_obj.seek(0)
    return Image.open(io.BytesIO(file_obj.read()))


# --- View Functions ---


def chat_index(request):
    """Renders the main chat interface HTML page (expects a proper template name)."""
    # If your templates are set up, use the template path inside your app, e.g. 'chat/index.html'
    return render(request, 'chat/index.html')


@require_POST
def chat_send(request):
    """
    Handles the multimodal chat POST request.
    Accepts:
      - multipart/form-data: 'message' (string, optional), 'image' (file, optional)
      - OR JSON body: {'message': str, 'image': base64_str} (legacy - still supported)

    Returns JSON: {'response': str, 'image_url': str (optional)}
    """
    if not chat_session:
        return JsonResponse({'response': 'AI service is unavailable due to configuration error.'}, status=503)

    try:
        user_message = ""
        uploaded_image = None
        image_url = None
        pil_image = None

        content_type = request.META.get('CONTENT_TYPE', '')

        # --- Case 1: multipart/form-data (preferred) ---
        if content_type.startswith("multipart/form-data"):
            user_message = (request.POST.get('message') or "").strip()
            uploaded_image = request.FILES.get('image')
            if uploaded_image:
                # Validate content type and size
                if not uploaded_image.content_type.startswith(ALLOWED_IMAGE_PREFIX):
                    return JsonResponse({'response': 'Invalid file type. Only images are allowed.'}, status=400)
                if uploaded_image.size > MAX_UPLOAD_SIZE:
                    return JsonResponse({'response': f'Image too large (max {MAX_UPLOAD_SIZE // (1024*1024)}MB).'}, status=400)

                # Save uploaded image to storage (optional) and produce PIL image for Gemini if needed
                try:
                    # If you want to persist uploaded files, save them and return the URL
                    image_url = _save_uploaded_file(uploaded_image)
                except Exception as e:
                    logger.exception("Error saving uploaded image: %s", e)
                    # Do not fail the entire request if saving fails; continue with in-memory usage if possible

                try:
                    # Rewind and open PIL image for passing to Gemini
                    # Note: request.FILES[...] is an UploadedFile object; read from it returns bytes.
                    uploaded_image.seek(0)
                    pil_image = Image.open(io.BytesIO(uploaded_image.read()))
                except Exception as e:
                    logger.exception("Error opening PIL image from uploaded file: %s", e)
                    return JsonResponse({'response': 'Failed to process uploaded image.'}, status=400)

        else:
            # --- Case 2: legacy JSON body (base64 image) ---
            try:
                payload = json.loads(request.body.decode('utf-8') or "{}")
            except json.JSONDecodeError:
                return JsonResponse({'response': 'Invalid JSON format.'}, status=400)

            user_message = (payload.get('message') or "").strip()
            base64_image = payload.get('image')
            if base64_image:
                # Accept data URLs like "data:image/png;base64,...." or plain base64 string
                if ',' in base64_image:
                    _, base64_data = base64_image.split(',', 1)
                else:
                    base64_data = base64_image

                try:
                    binary = base64.b64decode(base64_data)
                except Exception:
                    return JsonResponse({'response': 'Invalid base64 image data.'}, status=400)

                # Basic size check
                if len(binary) > MAX_UPLOAD_SIZE:
                    return JsonResponse({'response': f'Image too large (max {MAX_UPLOAD_SIZE // (1024*1024)}MB).'}, status=400)

                try:
                    pil_image = Image.open(io.BytesIO(binary))
                except Exception:
                    return JsonResponse({'response': 'Failed to decode image.'}, status=400)

                # Optionally save the binary to storage and get a URL
                try:
                    saved_path = default_storage.save('chat_uploads/uploaded_from_json.png', ContentFile(binary))
                    image_url = default_storage.url(saved_path)
                except Exception:
                    logger.exception("Failed to save base64 image to storage; continuing without saved URL.")

        # If nothing provided
        if not user_message and not pil_image:
            return JsonResponse({'response': 'Please send text or an image.'}, status=200)

        # --- Prepare contents for Gemini chat ---
        # The Gemini SDK's expected types for multimodal inputs may vary. In the original code
        # you passed PIL.Image objects. We'll preserve that, passing a list composed of the
        # text (if present) and the PIL image (if present). If Gemini expects bytes or file
        # objects instead, adapt here accordingly.
        contents = []
        if user_message:
            contents.append(user_message)
        if pil_image:
            contents.append(pil_image)

        # --- Send to Gemini and obtain response ---
        try:
            response = chat_session.send_message(contents)
            # The SDK might return different shapes; try to read a text attribute or fallback
            bot_reply = getattr(response, "text", None) or (response.get("text") if isinstance(response, dict) else None)
            if not bot_reply:
                # Last-resort: cast response to str
                bot_reply = str(response)
        except Exception as e:
            logger.exception("Gemini API error while sending message: %s", e)
            return JsonResponse({'response': 'Sorry, the AI assistant encountered an error. Please try again.'}, status=500)

        # --- Return response (include image_url if we saved one) ---
        result = {'response': bot_reply}
        if image_url:
            result['image_url'] = image_url

        return JsonResponse(result)

    except Exception as exc:
        # Catch-all — don't expose internals to client
        logger.exception("Unexpected error in chat_send: %s", exc)
        return JsonResponse({'response': 'Internal server error.'}, status=500)
