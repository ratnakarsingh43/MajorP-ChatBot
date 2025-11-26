# Major Project ChatBot

A simple chatbot web app built with **Django**, **HTML**, **CSS**, and **JavaScript**, currently using the **Google Gemini API** for generating responses.  
The goal is to start as a basic chatbot and gradually grow it into a more powerful, feature-rich assistant.

---

## 🔧 Tech Stack

- **Backend:** Django
- **Frontend:** HTML, CSS, JavaScript
- **AI Model:** Google Gemini API
- **Database:** SQLite (default Django DB)
- **Environment:** Python 3.x

---

## 📁 Project Structure (simplified)

```text
ChatBot/              # Django project folder
  settings.py
  urls.py
  wsgi.py
  asgi.py

chat/                 # Main app
  migrations/
  static/chat/
    chat.css
    chat.js
  templates/chat/
    index.html
  views.py
  urls.py
  models.py
  apps.py
  admin.py

.env                  # Environment variables (not committed)
db.sqlite3            # Local dev database
manage.py
