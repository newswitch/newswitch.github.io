from pydantic import BaseModel, ConfigDict, Field, ValidationError

class CreateJob(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=80)
    priority: int = Field(default=1, ge=1, le=5)

class StrictInput(BaseModel):
    count: int = Field(strict=True)

def main():
    job = CreateJob.model_validate({"name": "import", "priority": "2"})
    print(job.model_dump())
    try:
        StrictInput.model_validate({"count": "2"})
    except ValidationError:
        print("strict input rejected")
    print("name" in CreateJob.model_json_schema()["properties"])

if __name__ == "__main__":
    main()
