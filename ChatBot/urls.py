from django.contrib import admin
from django.urls import path, include
from chat.views import chat_index

urlpatterns = [
    path('admin/', admin.site.urls),
    
    # Route the root URL (/) to the chat_index view (renders index.html)
    path('', chat_index, name='home'), 
    
    # Route all requests starting with /chat/ to the chat app's urls.py
    path('chat/', include('chat.urls')), 
]
