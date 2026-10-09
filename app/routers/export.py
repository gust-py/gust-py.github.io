from fastapi import APIRouter, Response, HTTPException
from app.services.csv_export import build_csv

router = APIRouter()


@router.post("/export")
async def export_report(report_id: str):
    if not report_id:
        raise HTTPException(status_code=400, detail="report_id is required")
    rows = await fetch_report_rows(report_id)
    csv_bytes = build_csv(rows)
    return Response(content=csv_bytes, media_type="text/csv")
