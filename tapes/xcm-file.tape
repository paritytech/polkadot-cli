# xcm-file — hard calls belong in a file. Any command the CLI takes inline can be
# written as YAML or JSON instead: the chain, the call, its arguments, and
# `${VAR}` placeholders filled at run time. XCM is the case that makes it worth
# it — nested Locations and instruction lists nobody wants to type twice.
#
# Runs backwards on purpose: the hex first, so the file that produced it lands as
# the answer rather than as homework. That also puts the tallest screen last.
#
# The setup `cd`s off camera into tapes/demo/files, where the example lives, so
# the recorded commands read the way the docs write them.

Output docs/static/vhs/xcm-file.gif
Output docs/static/vhs/xcm-file.webm
Output docs/static/vhs/xcm-file.mp4

Source tapes/theme.tape

# Two points below the shared size so the whole file fits above the fold and the
# 32-byte beneficiary key stays on one line; at 20 both overflow.
Set FontSize 18
Set Height 730

Source tapes/shell.tape

Hide
Type "cd tapes/demo/files"
Enter
Ctrl+L
Sleep 300ms
Show

Type "# one teleport, and this is what you would otherwise be typing"
Enter
Sleep 1500ms

Type "dot ./teleport.xcm.yaml --var AMOUNT=10000000000 --encode"
Enter
Sleep 4500ms
Ctrl+L

Type "# leave the variable out and it tells you how to supply it"
Enter
Sleep 1500ms

Type "dot ./teleport.xcm.yaml --encode"
Enter
Sleep 4500ms
Ctrl+L

Type "# because the readable version is the file — chain, call, args, variable"
Enter
Sleep 1800ms

Type "cat teleport.xcm.yaml"
Enter
Sleep 7s
