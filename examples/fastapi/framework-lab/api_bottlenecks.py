"""Bounded teaching endpoints. Bind only to loopback for local experiments."""
import asyncio
import time
from typing import Annotated
from fastapi import FastAPI, Query

app = FastAPI()
Delay = Annotated[float, Query(ge=0.001, le=0.2)]


@app.get("/blocking")
async def blocking(delay: Delay = 0.02):
    time.sleep(delay)
    return {"ok": True}


@app.get("/threaded")
def threaded(delay: Delay = 0.02):
    time.sleep(delay)
    return {"ok": True}


@app.get("/asynchronous")
async def asynchronous(delay: Delay = 0.02):
    await asyncio.sleep(delay)
    return {"ok": True}


@app.get("/health/live")
async def live():
    return {"alive": True}
