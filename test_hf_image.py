import os
import requests
import base64
import json # Added to handle potential error details more robustly

HF_API_TOKEN = os.getenv("HF_API_TOKEN")
HF_IMAGE_GENERATION_API_URL = "https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-3.5-turbo"

def test_huggingface_image_generation(prompt_text):
    print(f"בודק יצירת תמונה עבור: '{prompt_text}'...")
    headers = {"Authorization": f"Bearer {HF_API_TOKEN}"}
    payload = {"inputs": prompt_text}

    try:
        response = requests.post(HF_IMAGE_GENERATION_API_URL, headers=headers, json=payload)
        response.raise_for_status() # Raises an HTTPError for bad responses (4xx or 5xx)

        image_bytes = response.content
        if image_bytes:
            # To ensure it's a valid JPEG, we can re-decode from base64 and then encode to bytes
            # This also helps if the direct content isn't immediately a byte stream
            # In practice, response.content should be sufficient, but this adds robustness
            filename = "test_image_hf.jpg"
            with open(filename, "wb") as f:
                # No need for double encode/decode with direct bytes, just write response.content
                f.write(image_bytes) 
            print(f"--- תמונה נוצרה ונשמרה כ- {filename} ---")
            print("אתה יכול למצוא את התמונה בתיקייה הנוכחית (chayim-beseret).")
        else:
            print("--- לא נוצרה תמונה. התגובה מ-Hugging Face הייתה ריקה. ---")
    except requests.exceptions.RequestException as e:
        print(f"!!! שגיאה חמורה בתקשורת עם Hugging Face ליצירת תמונה: {e} !!!")
        if response is not None and response.content: # Check if response object exists
            try:
                error_details = json.loads(response.content)
                print(f"פרטי שגיאה מ-HF: {error_details}")
            except json.JSONDecodeError:
                print(f"תוכן תגובת שגיאה גולמי מ-HF: {response.content.decode('utf-8', errors='ignore')}")

# --- הרצת הבדיקה ---
if __name__ == "__main__":
    test_huggingface_image_generation("A cute dog playing with a red ball in a park, cartoon style, bright and colorful.")