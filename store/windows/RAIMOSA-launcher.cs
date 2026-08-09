// RAIMOSA AI — MSIX full-trust entry point.
//
// MSIX requires a real executable as the app's entry point. This minimal
// WinExe launches the existing, tested PowerShell shell (RAIMOSA.ps1) from
// inside the installed package, so all of the runtime-ownership and
// window logic lives in one reviewed place rather than being reimplemented.
//
// Compiled on Windows by package.ps1 using the built-in C# compiler (csc.exe);
// no external toolchain is required.

using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;

internal static class Program
{
    private static int Main()
    {
        // The package layout places this exe at the package root, with the
        // shell at native\windows\RAIMOSA.ps1 beside app\ and vendor\.
        string root = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
        string shell = Path.Combine(root, "native", "windows", "RAIMOSA.ps1");

        if (!File.Exists(shell))
        {
            // Never fail silently: tell the user exactly what is missing.
            System.Windows.Forms.MessageBox.Show(
                "RAIMOSA could not find its shell at:\n" + shell,
                "RAIMOSA AI");
            return 1;
        }

        var psi = new ProcessStartInfo
        {
            FileName = "powershell.exe",
            Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"" + shell + "\"",
            UseShellExecute = false,
            CreateNoWindow = true,
            WorkingDirectory = root,
        };

        try
        {
            Process.Start(psi);
            return 0;
        }
        catch (Exception ex)
        {
            System.Windows.Forms.MessageBox.Show(
                "RAIMOSA could not start:\n" + ex.Message, "RAIMOSA AI");
            return 1;
        }
    }
}
