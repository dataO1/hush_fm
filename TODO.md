- [ ] remote connection only works for tcp not udp
- [ ] joining with a second listener destroys the ice connection for the first
  one.

### UDP Problems

Based on the WebRTC 1.0 Candidate Recommendation and the previously analyzed logs, the UDP candidates from the backend were not used because they could not form a valid Candidate Pair with the client's available candidates.

Here is the breakdown of why this occurred according to the standard:
1. The RTCIceTransportPolicy Was Likely Correct ("all")

The standard defines the RTCIceTransportPolicy enum with two values:

    "relay": The ICE Agent uses only media relay candidates (TURN). This prevents the remote endpoint from learning the user's IP addresses.

    "all" (Default): The ICE Agent can use any type of candidate (Host, Server Reflexive, Relay).

Evidence: The logs showed the client gathering candidates with typ host (e.g., candidate:... typ host ...).

    Conclusion: If the policy were set to "relay", these host candidates would have been suppressed entirely. Since host candidates were generated, the iceTransportPolicy was correctly set to "all" (or left as default). Therefore, an incorrect transport policy setting is not the cause of the UDP failure .

2. Failure Mechanism: Candidate Pairing & Protocol Mismatch

According to the specification, the ICE Agent is responsible for establishing connectivity by performing checks on Candidate Pairs (a local candidate paired with a remote candidate) .

    The Constraint: A valid candidate pair must share the same transport protocol.

        Client (Local): Gathered only TCP candidates (protocol: tcp).

        Server (Remote): Provided only UDP candidates (protocol: udp).

    The Result: The ICE Agent could not create a single valid pair (e.g., Local TCP + Remote UDP is invalid). Without a valid pair, the Connectivity Check phase cannot start, leading to the iceConnectionState remaining in checking or new until it eventually times out to failed.

3. Why were Local UDP candidates missing?

The standard notes: "The implementation can still use its own candidate filtering policy in order to limit the IP addresses exposed to the application." .

Since the policy allowed "all" candidates, the absence of local UDP candidates indicates an Environmental or Administrative Restriction rather than a WebRTC configuration error. The browser's ICE Agent detected that UDP was blocked (e.g., by a firewall, OS permissions, or container network isolation) and effectively "pruned" UDP from the gathering process before presenting candidates to the application.
Summary of Fix

The standard confirms that the RTCIceTransportPolicy does not need to be changed. Instead, you must resolve the protocol mismatch by either:

    Unblocking UDP on the client's network/container.

    Enabling TCP on the Backend (MediaSoup), allowing the client's existing TCP candidates to pair with a Server TCP candidate.

