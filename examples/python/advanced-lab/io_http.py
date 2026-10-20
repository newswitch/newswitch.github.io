import httpx

def main():
    def handle(request):
        return httpx.Response(200, json={"path": request.url.path})

    timeout = httpx.Timeout(3.0, connect=1.0, pool=0.5)
    with httpx.Client(transport=httpx.MockTransport(handle),
                      timeout=timeout, trust_env=False) as client:
        response = client.get("https://example.test/jobs")
        response.raise_for_status()
        print(response.status_code, response.json()["path"])

if __name__ == "__main__":
    main()
