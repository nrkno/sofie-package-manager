:: Note: This script uses cports.exe which can be obtained here: https://www.nirsoft.net/utils/cports.html
:: This script is intended to clean up "zombie" TCP connections on a Windows computer.
:: Run this script using the Windows Scheduler (set Administrative privileges!) nighly.

:: Close all local connections that targets a certain remote address & port:
C:\Scripts\cports.exe /close * * 10.0.1.111 443
C:\Scripts\cports.exe /close * * 10.0.1.111 3000
