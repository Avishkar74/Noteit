@echo off
REM Run this script as Administrator to allow inbound traffic on ports used for local testing.
REM Usage: Right-click -> Run as administrator, or run from an elevated cmd/powershell.

echo Adding firewall rule for port 3000 (backend)
netsh advfirewall firewall add rule name="Snabby Backend 3000" dir=in action=allow protocol=TCP localport=3000 profile=Private,Public
echo Adding firewall rule for port 5500 (static server)
netsh advfirewall firewall add rule name="Snabby Static 5500" dir=in action=allow protocol=TCP localport=5500 profile=Private,Public
echo Done. To remove the rules, run:
echo netsh advfirewall firewall delete rule name="Snabby Backend 3000"
echo netsh advfirewall firewall delete rule name="Snabby Static 5500"
pause