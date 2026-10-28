"""Shared LLM factory — returns a Groq-backed ChatGroq instance.

Groq provides fast inference on open-weight models (Llama, Mixtral, Gemma).
Sign up at https://console.groq.com to get a free API key.
"""
from __future__ import annotations

from langchain_groq import ChatGroq

from shared.config import get_settings


def get_llm(max_tokens: int = 1024, temperature: float = 0.1) -> ChatGroq:
    settings = get_settings()
    if not settings.groq_api_key or settings.groq_api_key == "your-groq-api-key-here":
        raise RuntimeError(
            "GROQ_API_KEY is not set. "
            "Get a free key at https://console.groq.com and add it to app/.env"
        )
    return ChatGroq(
        api_key=settings.groq_api_key,
        model=settings.groq_model,
        max_tokens=max_tokens,
        temperature=temperature,
    )
