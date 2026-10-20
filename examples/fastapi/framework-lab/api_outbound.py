import asyncio
import httpx

async def fetch(client, job_id):
    response = await client.get(f"/jobs/{job_id}")
    response.raise_for_status()
    return response.json()

async def main():
    def handle(request):
        if request.url.path == "/jobs/1":
            return httpx.Response(200, json={"id": 1})
        return httpx.Response(503)

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(handle), base_url="https://upstream.test",
        timeout=httpx.Timeout(2.0, connect=0.5, pool=0.2),
        limits=httpx.Limits(max_connections=10), trust_env=False,
    ) as client:
        print(await fetch(client, 1))
        try:
            await fetch(client, 2)
        except httpx.HTTPStatusError as error:
            print("upstream:", error.response.status_code)

if __name__ == "__main__":
    asyncio.run(main())
