from typing import Annotated
from fastapi import FastAPI, File, HTTPException, UploadFile

app = FastAPI()

@app.post("/uploads")
async def upload(file: Annotated[UploadFile, File()]):
    size = 0
    try:
        while chunk := await file.read(65536):
            size += len(chunk)
            if size > 1024 * 1024:
                raise HTTPException(413, "file too large")
        return {"bytes": size}
    finally:
        await file.close()

def main():
    from fastapi.testclient import TestClient
    with TestClient(app) as client:
        response = client.post("/uploads", files={
            "file": ("sample.txt", b"hello", "text/plain")})
        print(response.status_code, response.json())

if __name__ == "__main__":
    main()
