import io
import json
import unittest
from unittest.mock import patch

from deploy.request import request_deployment


class DeploymentRequestTests(unittest.TestCase):
    def test_rejects_application_url_as_deployment_endpoint(self):
        with self.assertRaisesRegex(ValueError, "URL HTTPS"):
            request_deployment(
                "https://example.test/algo-programmation-ihme/",
                "private-token",
                "sha256:" + "a" * 64,
            )

    def test_requires_digest_and_private_token(self):
        with self.assertRaisesRegex(ValueError, "Jeton privé"):
            request_deployment(
                "https://example.test/__deploy/p02",
                "",
                "not-a-digest",
            )

    @patch("deploy.request.urllib.request.build_opener")
    def test_posts_digest_and_accepts_only_healthy_response(self, build_opener):
        response = io.BytesIO(
            b'{"status":"healthy","project":"p02","digest":"sha256:'
            + b"a" * 64
            + b'"}'
        )
        response.status = 200
        opener = build_opener.return_value
        opener.open.return_value = response

        result = request_deployment(
            "https://example.test/__deploy/p02",
            "private-token",
            "sha256:" + "a" * 64,
            "registry-token",
        )

        self.assertEqual(result["status"], "healthy")
        request = opener.open.call_args.args[0]
        self.assertEqual(request.full_url, "https://example.test/__deploy/p02")
        self.assertEqual(request.headers["Authorization"], "Bearer private-token")
        self.assertEqual(
            json.loads(request.data),
            {
                "digest": "sha256:" + "a" * 64,
                "registry_token": "registry-token",
            },
        )
        self.assertEqual(
            request.headers["Content-type"],
            "application/json",
        )


if __name__ == "__main__":
    unittest.main()
