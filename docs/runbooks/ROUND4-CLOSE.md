# Round 4 close: exact steps (draft, needs user approval)

Contract: FlatstockVotes `0x4BB945800d588E6B4DB287b3fCe9C13f7825A968`, chain 4663.
Round 4 `closesAt` = 1794232800 = Mon 9 Nov 2026 14:00 UTC = **15:00 WAT**.

What `closeRound(4)` does (src/FlatstockVotes.sol): reverts before `closesAt`; then freezes the final
weights from the votes, sets `closed = true`, emits `RoundClosed`. It is **permissionless**: anyone can
call it after 15:00, so there is no admin key risk. It cannot open round 5 (`openRound` is `onlyOwner`).
Cost: one small tx, paid from the relayer's ETH (~0.00098 ETH now).

## A. Before Mon 9 Nov (read-only, can be done any time)

1. On the VPS, make sure `/etc/flatstock/flatstock.env` has (names only, no secrets shown):
   `VOTE_ROUND_ID=4`, `CLOSE_ROUND_EXPECTED_CLOSES_AT=1794232800`, `META_VOTES_ADDRESS=0x4BB945800d588E6B4DB287b3fCe9C13f7825A968`, `CLOSE_ROUND_ENABLED=0`.
   Check without printing secrets:
   `sudo grep -E '^(VOTE_ROUND_ID|CLOSE_ROUND_EXPECTED_CLOSES_AT|META_VOTES_ADDRESS|CLOSE_ROUND_ENABLED)=' /etc/flatstock/flatstock.env`
2. VPS checkout must include fix `4072deb` (the clean-history equivalent). Run `git -C /opt/flatstock log -3 --oneline`.
3. Dry run (disabled = read-only, sends nothing):
   `sudo systemctl start flatstock-close-round.service; sudo journalctl -u flatstock-close-round.service -n 5 --no-pager`
   Expect: `"action":"none"`, `"roundId":"4"`, `"closesAt":"1794232800"`, `"decision":"not-due"`, `"closed":false`.
   If `expected-mismatch` or `missing` shows, stop and tell me.
4. Relayer balance must stay above 0.0003 ETH (currently 0.00098). Check: `curl -s https://api.flatstock.ajkadri.dev/api/health`.

## B. At Mon 9 Nov 15:00 WAT (the close, needs your approval right before)

Option 1, the bot (recommended, it has the safety checks):
1. Tell me "approve closing round 4". I will confirm: contract above, round 4, closesAt matches, tx cost.
2. On the VPS set `CLOSE_ROUND_ENABLED=1` in the env file (backup the file first), then:
   `sudo systemctl start flatstock-close-round.service; sudo journalctl -u flatstock-close-round.service -n 5 --no-pager`
   Expect `"action":"closed"`, a tx `hash`, `"status":"success"`.
   (Do not enable the 5-minute timer unless you want it to retry on its own; one manual run is enough.)
3. Set `CLOSE_ROUND_ENABLED=0` again so nothing else can fire.

Option 2, no VPS: anyone can call `closeRound(4)` from a wallet after 15:00. Only if the bot fails.

## C. Verify (read-only, I run these)

- `rounds(4)` shows `closed = true`; `weightBps(4, 0..2)` returns the frozen mix.
- Record the tx hash, the final weights and the total votes in CHECKS.md.
- Check the live app after the close.

## D. After the close

- **Round 5 is not opened by anything automatic.** Opening needs your approval and a tx from the owner key; I will
  propose the exact `openRound` call (round id, asset count, closesAt, vote share) and wait for your yes.
- Feature freeze starts at 15:00. Between close and round 5 opening, the app's state is not yet verified:
  I will check what the UI shows and report before you decide when to open round 5.
- Round 5 should be open before the demo is recorded, so judges see two real rounds.
