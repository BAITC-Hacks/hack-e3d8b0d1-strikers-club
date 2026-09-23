from pydantic import BaseModel, Field


class ErrorDetail(BaseModel):
    location: list[str | int]
    type: str


class ErrorBody(BaseModel):
    code: str
    message: str
    details: list[ErrorDetail] = Field(default_factory=list)


class ErrorResponse(BaseModel):
    error: ErrorBody
    request_id: str
