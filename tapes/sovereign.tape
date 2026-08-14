# sovereign — the addresses nobody should be computing by hand. A pallet's
# sovereign account comes from its PalletId, a parachain's from its ID, and a
# parachain has two of them: the child sovereign it holds on its own relay chain
# and the sibling sovereign it holds on every other parachain.
#
# Derivation is pure arithmetic, so every frame here is offline and identical
# between takes. Only the balance query touches the network.
#
# Closes on `dot account list` — the tallest screen, so the frame the viewer is
# left looking at is a full one.

Output docs/static/vhs/sovereign.gif
Output docs/static/vhs/sovereign.webm
Output docs/static/vhs/sovereign.mp4

Source tapes/theme.tape

# Sized for `dot account list`: six dev accounts plus three sovereigns, each with
# the derivation it came from printed underneath.
Set Height 760

Source tapes/shell.tape

Type "# a pallet's sovereign address, derived from its PalletId"
Enter
Sleep 1200ms

Type "dot account add Treasury --pallet-id py/trsry"
Enter
Sleep 2500ms

Type "# a parachain has two: child on its relay, sibling on every other parachain"
Enter
Sleep 1800ms

Type "dot account add HydrationChild --parachain 2034 --parachain-type child"
Enter
Sleep 2500ms

Type "dot account add HydrationSibling --parachain 2034 --parachain-type sibling"
Enter
Sleep 3s
Ctrl+L

Type "# stored by name, so they work anywhere an address does"
Enter
Sleep 1500ms

Type "dot polkadot-asset-hub.query.System.Account HydrationSibling"
Enter
Sleep 4500ms
Ctrl+L

Type "dot account list"
Enter
Sleep 5s
