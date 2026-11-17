import os
import unittest
from datetime import timedelta
from uuid import uuid4

from temporalio.client import WorkflowFailureError
from temporalio.exceptions import ActivityError, ApplicationError
from temporalio.testing import WorkflowEnvironment
from temporalio.worker import Replayer, Worker

from fakes import ChangeActivities
from workflows import ApprovalWorkflow


class WorkflowTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.env = await WorkflowEnvironment.start_time_skipping(
            test_server_existing_path=os.environ.get("TEMPORAL_TEST_SERVER")
        )
        self.queue = f"approval-test-{uuid4()}"

    async def asyncTearDown(self) -> None:
        await self.env.shutdown()

    def worker(self, fake: ChangeActivities) -> Worker:
        return Worker(
            self.env.client,
            task_queue=self.queue,
            workflows=[ApprovalWorkflow],
            activities=[fake.apply_change],
        )

    async def start(self):
        return await self.env.client.start_workflow(
            ApprovalWorkflow.run,
            "change-001",
            id=f"approval-{uuid4()}",
            task_queue=self.queue,
        )

    async def test_expiry_without_activity(self) -> None:
        fake = ChangeActivities()
        async with self.worker(fake):
            handle = await self.start()
            self.assertEqual(await handle.result(), "expired")
        self.assertEqual(fake.calls, [])

    async def test_signal_before_deadline_and_retry(self) -> None:
        fake = ChangeActivities(failures=2)
        async with self.worker(fake):
            handle = await self.start()
            self.assertEqual(await handle.query(ApprovalWorkflow.status), "waiting")
            await self.env.sleep(timedelta(days=29))
            self.assertEqual(await handle.query(ApprovalWorkflow.status), "waiting")
            await handle.signal(ApprovalWorkflow.approve)
            self.assertEqual(await handle.result(), "applied")
        self.assertEqual(
            fake.calls,
            [("change-001", 1), ("change-001", 2), ("change-001", 3)],
        )

    async def test_non_retryable_failure(self) -> None:
        fake = ChangeActivities(reject=True)
        async with self.worker(fake):
            handle = await self.start()
            await handle.signal(ApprovalWorkflow.approve)
            with self.assertRaises(WorkflowFailureError) as caught:
                await handle.result()
        self.assertIsInstance(caught.exception.cause, ActivityError)
        self.assertIsInstance(caught.exception.cause.cause, ApplicationError)
        self.assertEqual(caught.exception.cause.cause.type, "RejectedChange")
        self.assertEqual(fake.calls, [("change-001", 1)])

    async def test_completed_history_replays_without_activity(self) -> None:
        fake = ChangeActivities()
        async with self.worker(fake):
            handle = await self.start()
            await handle.signal(ApprovalWorkflow.approve)
            self.assertEqual(await handle.result(), "applied")
            history = await handle.fetch_history()
        before = list(fake.calls)
        result = await Replayer(workflows=[ApprovalWorkflow]).replay_workflow(history)
        self.assertIsNone(result.replay_failure)
        self.assertEqual(fake.calls, before)


if __name__ == "__main__":
    unittest.main()
