import asyncio
import httpx

async def application(scope, receive, send):
    if scope["type"] != "http":
        raise RuntimeError("HTTP only")
    message = await receive()
    body = (scope["method"] + ":" + scope["path"]).encode()
    await send({"type": "http.response.start", "status": 200,
                "headers": [(b"content-type", b"text/plain")]})
    await send({"type": "http.response.body", "body": body})

async def main():
    transport = httpx.ASGITransport(app=application)
    async with httpx.AsyncClient(transport=transport,
                                  base_url="http://test") as client:
        response = await client.get("/jobs")
        print(response.status_code, response.text)

if __name__ == "__main__":
    asyncio.run(main())
