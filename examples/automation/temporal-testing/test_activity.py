import unittest
from dataclasses import replace

from temporalio.exceptions import ApplicationError
from temporalio.testing import ActivityEnvironment

from fakes import ChangeActivities


class ActivityTests(unittest.IsolatedAsyncioTestCase):
    async def test_success_and_heartbeat(self) -> None:
        env = ActivityEnvironment()
        heartbeats = []
        env.on_heartbeat = lambda *details: heartbeats.append(details)
        fake = ChangeActivities()
        self.assertEqual(await env.run(fake.apply_change, "change-001"), "applied")
        self.assertEqual(fake.calls, [("change-001", 1)])
        self.assertEqual(heartbeats, [("change-001",)])

    async def test_activity_environment_does_not_retry(self) -> None:
        env = ActivityEnvironment()
        fake = ChangeActivities(failures=2)
        with self.assertRaises(ApplicationError) as caught:
            await env.run(fake.apply_change, "change-001")
        self.assertEqual(caught.exception.type, "TransientChange")
        self.assertFalse(caught.exception.non_retryable)
        self.assertEqual(fake.calls, [("change-001", 1)])

    async def test_explicit_attempt_context(self) -> None:
        env = ActivityEnvironment()
        env.info = replace(env.info, attempt=3)
        fake = ChangeActivities(failures=2)
        self.assertEqual(await env.run(fake.apply_change, "change-001"), "applied")
        self.assertEqual(fake.calls, [("change-001", 3)])

    async def test_non_retryable_error(self) -> None:
        env = ActivityEnvironment()
        fake = ChangeActivities(reject=True)
        with self.assertRaises(ApplicationError) as caught:
            await env.run(fake.apply_change, "change-001")
        self.assertEqual(caught.exception.type, "RejectedChange")
        self.assertTrue(caught.exception.non_retryable)
        self.assertEqual(len(fake.calls), 1)


if __name__ == "__main__":
    unittest.main()
