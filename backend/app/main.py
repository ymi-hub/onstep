from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import assets, flow_guide, care_plan

app = FastAPI(
    title="OnStep API",
    description="Zero Setting: Life 관리는 리스트에서 즉시",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(flow_guide.router)
app.include_router(assets.router)
app.include_router(care_plan.router)


@app.get("/health")
async def health():
    return {"status": "ok"}
