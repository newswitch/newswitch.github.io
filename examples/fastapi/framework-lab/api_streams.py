from fastapi import FastAPI, WebSocket
from fastapi.responses import StreamingResponse

app = FastAPI()

@app.get("/events")
async def events():
    async def generate():
        yield "id: 1\nevent: state\ndata: ready\n\n"
    return StreamingResponse(generate(), media_type="text/event-stream")

@app.websocket("/ws")
async def websocket(websocket: WebSocket):
    await websocket.accept()
    message = await websocket.receive_text()
    await websocket.send_text(message.upper())
    await websocket.close()

def main():
    from fastapi.testclient import TestClient
    with TestClient(app) as client:
        response = client.get("/events")
        print("data: ready" in response.text)
        with client.websocket_connect("/ws") as socket:
            socket.send_text("hello")
            print(socket.receive_text())

if __name__ == "__main__":
    main()
