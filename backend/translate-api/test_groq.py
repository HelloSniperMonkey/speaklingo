#!/usr/bin/env python3
"""Quick test of Groq API"""

from groq import Groq
from dotenv import load_dotenv
from config import Config

load_dotenv()

client = Groq(api_key=Config.GROQ_API_KEY)

test_text = "hello can you listen to me"

prompt = f"""Translate the following text to English. Only provide the translation, no additional text.

Text: {test_text}

Translation:"""

try:
    response = client.chat.completions.create(
        model="openai/gpt-oss-safeguard-20b",
        messages=[
            {
                "role": "user",
                "content": prompt
            }
        ],
        temperature=0.1,
        max_completion_tokens=100,
        top_p=1,
        stream=False
    )
    
    print(f"Response object: {response}")
    print(f"\nContent: {response.choices[0].message.content}")
    print(f"Content type: {type(response.choices[0].message.content)}")
    
except Exception as e:
    print(f"Error: {e}")
    import traceback
    traceback.print_exc()
