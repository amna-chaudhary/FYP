import unittest

from backend import agent


class AgentFlowTests(unittest.TestCase):
    def setUp(self):
        agent.pending_confirmations.clear()
        agent.pending_slot_sessions.clear()
        agent.conversation_memory.clear()
        self.original_chat_model = agent.chat_model
        agent.chat_model = None
        agent.APTOS_SENDER_ADDRESS = "0xabc123abc123abc123abc123abc123abc123"
        agent.APTOS_SENDER_PRIVATE_KEY_HEX = "f" * 64
        agent.DEFAULT_REGISTRY_ADDR = "0x1111111111111111111111111111111111111111"
        agent.DEFAULT_MARKET_ADDR = "0x2222222222222222222222222222222222222222"

    def tearDown(self):
        agent.chat_model = self.original_chat_model

    def test_cert_create_slot_filling_loop(self):
        first = agent.decide_and_respond("issue 50 solar certificate", user_id="u1")
        self.assertEqual(first["type"], "answer")
        self.assertIn("location", first["text"].lower())

        follow_up = agent.decide_and_respond("Lahore", user_id="u1")
        self.assertEqual(follow_up["type"], "action")
        self.assertEqual(follow_up["mcp_request"]["tool_name"], "cert_create")
        self.assertEqual(follow_up["mcp_request"]["arguments"]["energy_amount"], 50)
        self.assertEqual(follow_up["mcp_request"]["arguments"]["energy_source"], "solar")
        self.assertEqual(follow_up["mcp_request"]["arguments"]["location"], "Lahore")
        self.assertNotIn("owner", follow_up["mcp_request"]["arguments"])

        agent.pending_slot_sessions.clear()
        agent.conversation_memory.clear()
        agent.decide_and_respond("issue 40 wind certificate", user_id="u1c")
        comma_loc = agent.decide_and_respond("Punjab, Pakistan", user_id="u1c")
        self.assertEqual(comma_loc["type"], "action")
        self.assertEqual(comma_loc["mcp_request"]["arguments"]["location"], "Punjab, Pakistan")

        agent.pending_slot_sessions.clear()
        agent.conversation_memory.clear()
        agent.decide_and_respond("issue 10 solar certificate", user_id="u1b")
        buyer_addr = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
        with_owner = agent.decide_and_respond(
            "Islamabad",
            user_id="u1b",
            owner_account_address=buyer_addr,
        )
        self.assertEqual(with_owner["mcp_request"]["arguments"].get("owner"), buyer_addr.lower())

    def test_transfer_requires_confirmation(self):
        first = agent.decide_and_respond(
            "transfer cert 7 to 0x9999999999999999999999999999999999999999",
            user_id="u2",
        )
        self.assertEqual(first["type"], "answer")
        self.assertIn("are you sure", first["text"].lower())

        confirmed = agent.decide_and_respond("yes", user_id="u2")
        self.assertEqual(confirmed["type"], "action")
        self.assertEqual(confirmed["mcp_request"]["tool_name"], "cert_transfer")
        self.assertEqual(confirmed["mcp_request"]["arguments"]["cert_id"], 7)

    def test_cancel_confirmation_can_be_dismissed(self):
        first = agent.decide_and_respond("retire cert 12", user_id="u3")
        self.assertEqual(first["type"], "answer")
        self.assertIn("are you sure", first["text"].lower())

        cancelled = agent.decide_and_respond("cancel", user_id="u3")
        self.assertEqual(cancelled["type"], "answer")
        self.assertIn("cancelled", cancelled["text"].lower())

    def test_unknown_action_returns_clarification(self):
        result = agent.decide_and_respond("do something onchain for me", user_id="u4")
        self.assertEqual(result["type"], "answer")
        self.assertIn("not fully sure", result["text"].lower())

    def test_intent_classification_matrix_covers_supported_user_flows(self):
        cases = {
            "CERT_CREATE": [
                "issue 50 solar certificate in Lahore",
                "create certificate for 100 wind energy in Karachi",
                "mint a gec for 75 hydro in Islamabad",
                "issue certificate 40 biomass in Faisalabad",
                "create gec 120 geothermal in Quetta",
                "issue 30 thermal certificate in Multan",
                "please create certificate for 22 solar in Peshawar",
                "mint certificate 88 wind in Hyderabad",
                "issue a new gec for 65 solar energy in Sukkur",
                "create certificate 10 hydro in Gilgit",
            ],
            "CERT_TRANSFER": [
                "transfer cert 7 to 0x9999999999999999999999999999999999999999",
                "transfer certificate 8 to 0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "please transfer cert 5 to 0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                "send cert 4 to 0xcccccccccccccccccccccccccccccccccccccccc by transfer",
                "transfer cert 11 to 0xdddddddddddddddddddddddddddddddddddddddd recipient",
                "transfer certificate 12 over to 0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
                "can you transfer cert 13 to 0xffffffffffffffffffffffffffffffffffffffff",
                "transfer cert 14 to account 0x1111111111111111111111111111111111111111",
                "transfer cert 15 to 0x2222222222222222222222222222222222222222",
                "move by transfer cert 16 to 0x3333333333333333333333333333333333333333",
            ],
            "CERT_RETIRE": [
                "retire cert 12",
                "claim cert 4",
                "please retire certificate 7",
                "retire certificate #8 now",
                "claim certificate 9 for usage",
                "retire cert 10 immediately",
                "retire certificate 11 from registry",
                "claim cert 15 please",
                "retire cert 18",
                "claim certificate 20",
            ],
            "CERT_CANCEL": [
                "cancel certificate 2",
                "cancel cert 3",
                "void cert 4",
                "please cancel certificate 5",
                "cancel cert 6 from registry",
                "void certificate 7 immediately",
                "cancel certificate #8 now",
                "cancel cert 9 please",
                "void cert 10",
                "cancel certificate 11",
            ],
            "MARKET_LIST": [
                "list cert 1 for sale price 100",
                "list cert 2 on market price 200",
                "list cert 3 on sale price 300",
                "list certificate 4 on marketplace price 400",
                "list cert 5 on market price 500",
                "list cert 6 for market price 600",
                "list cert 7 sale price 700",
                "can you list cert 8 on market for price 800",
                "list cert 9 with price 900 on sale",
                "list cert 10 on market price 1000",
            ],
            "MARKET_REQUEST_BUY": [
                "buy listing 1",
                "request buy listing 2",
                "buy listing 3 from market",
                "please buy listing 4",
                "buy market listing 5",
                "request buy for listing 6",
                "buy listing 7 now",
                "can you buy listing 8 from marketplace",
                "buy listing 9 on market",
                "request buy listing 10 please",
            ],
            "MARKET_ACCEPT_BUY": [
                "accept buy request 1",
                "accept purchase request 2",
                "accept request for listing 3",
                "please accept buy for listing 4",
                "accept buy request on listing 5",
                "accept purchase on listing 6",
                "accept request listing 7",
                "accept buy request listing 8 now",
                "can you accept purchase request 9",
                "accept request for listing 10 please",
            ],
            "MARKET_CANCEL": [
                "cancel listing 1",
                "please cancel listing 2",
                "cancel listing 3 in marketplace",
                "cancel listing #4 now",
                "cancel listing 5 from market",
                "can you cancel listing 6",
                "cancel listing 7 please",
                "cancel listing 8 immediately",
                "cancel listing 9",
                "market cancel listing 10",
            ],
            "MARKET_STATS": [
                "market stats",
                "show market stats",
                "give me marketplace stats",
                "market stats please",
                "can you show market stats now",
                "display market stats",
                "open marketplace stats",
                "what are the market stats",
                "market stats for the platform",
                "please fetch market stats",
            ],
            "AUDIT_LOG": [
                "audit log action transfer details manual-check",
                "audit log action production details energy-recorded",
                "audit log action closure details owner-requested",
                "please audit log action cancellation details invalid-meter-data",
                "audit log action trade details matched-order",
                "audit log action verify details compliance-passed",
                "audit log action validation details hourly-data-confirmed",
                "audit log action offer-posted details listing-created",
                "audit log action settle details marketplace-cleared",
                "audit log action clearance details signer-whitelisted",
            ],
            "CERT_INIT": [
                "init registry",
                "cert init",
                "initialize certificate registry",
                "please init registry now",
                "can you init the cert registry",
                "registry init for certificates",
                "start cert init flow",
                "initialize registry for certs",
                "run cert init",
                "please initialize the cert registry",
            ],
            "MARKET_INIT": [
                "init marketplace",
                "market init",
                "initialize marketplace",
                "please init the market",
                "can you init marketplace now",
                "marketplace init please",
                "start market init flow",
                "initialize the marketplace contract",
                "run market init",
                "please initialize marketplace",
            ],
            "UNKNOWN": [
                "tell me a joke",
                "what is the weather tomorrow",
                "book a restaurant for dinner",
                "play some music",
                "write a poem about mountains",
                "how many moons does mars have",
                "translate this sentence to french",
                "set a timer for ten minutes",
                "who won the world cup",
                "open my calendar for next week",
            ],
        }

        for expected_intent, messages in cases.items():
            for index, message in enumerate(messages, start=1):
                with self.subTest(intent=expected_intent, sample=index):
                    result = agent.classify_intent(message, user_id=f"intent-{expected_intent}-{index}")
                    self.assertEqual(result["intent"], expected_intent)


if __name__ == "__main__":
    unittest.main()
