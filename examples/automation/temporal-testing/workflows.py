from datetime import timedelta

from temporalio import workflow
from temporalio.common import RetryPolicy


@workflow.defn
class ApprovalWorkflow:
    def __init__(self) -> None:
        self.approved = False
        self.phase = "waiting"

    @workflow.signal
    def approve(self) -> None:
        self.approved = True

    @workflow.query
    def status(self) -> str:
        return self.phase

    @workflow.run
    async def run(self, change_id: str) -> str:
        try:
            await workflow.wait_condition(
                lambda: self.approved, timeout=timedelta(days=30)
            )
        except TimeoutError:
            self.phase = "expired"
            return "expired"
        self.phase = "applying"
        result = await workflow.execute_activity(
            "apply_change",
            change_id,
            result_type=str,
            start_to_close_timeout=timedelta(seconds=2),
            schedule_to_close_timeout=timedelta(seconds=10),
            retry_policy=RetryPolicy(
                initial_interval=timedelta(seconds=1),
                maximum_interval=timedelta(seconds=1),
                maximum_attempts=3,
            ),
        )
        self.phase = "completed"
        return result
