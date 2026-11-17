from temporalio import activity
from temporalio.exceptions import ApplicationError


class ChangeActivities:
    """Test double only: records attempts, performs no external change."""

    def __init__(self, *, failures: int = 0, reject: bool = False) -> None:
        self.failures = failures
        self.reject = reject
        self.calls: list[tuple[str, int]] = []

    @activity.defn(name="apply_change")
    async def apply_change(self, change_id: str) -> str:
        attempt = activity.info().attempt
        self.calls.append((change_id, attempt))
        activity.heartbeat(change_id)
        if self.reject:
            raise ApplicationError(
                "change rejected", type="RejectedChange", non_retryable=True
            )
        if attempt <= self.failures:
            raise ApplicationError("temporary failure", type="TransientChange")
        return "applied"
