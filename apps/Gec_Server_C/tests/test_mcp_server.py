import unittest

import mcp_server


class MCPServerTests(unittest.TestCase):
    def test_operation_map_contains_registered_tools(self):
        self.assertIn("cert_create", mcp_server.operation_map)
        meta = mcp_server.operation_map["cert_create"]
        self.assertEqual(meta["method"], "post")
        self.assertIn("input_schema", meta)
        self.assertIn("output_schema", meta)

    def test_build_request_for_operation_maps_body_and_path(self):
        op_meta = mcp_server.operation_map["cert_transfer"]
        req = mcp_server.build_request_for_operation(
            op_meta,
            {
                "sender_private_key_hex": "abc",
                "sender_address": "0x1",
                "registry_addr": "0x2",
                "cert_id": 7,
                "recipient": "0x3",
            },
        )

        self.assertEqual(req["method"], "post")
        self.assertTrue(req["url"].endswith("/certificates/transfer"))
        self.assertIsNone(req["params"])
        self.assertEqual(req["json"]["cert_id"], 7)
        self.assertEqual(req["json"]["recipient"], "0x3")

    def test_list_tools_exposes_schema_metadata(self):
        payload = mcp_server.list_tools()
        self.assertGreater(payload["count"], 0)
        tool = next(item for item in payload["tools"] if item["tool_name"] == "cert_create")
        self.assertIn("input_schema", tool)
        self.assertIn("output_schema", tool)
        self.assertIn("log_path", payload)


if __name__ == "__main__":
    unittest.main()
