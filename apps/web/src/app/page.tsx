import { Terminal } from "@/components/Terminal";
import { kb } from "@/lib/knowledge";
import { cvConfig } from "@/server/cv";

export default function Home() {
  const github = kb.profile.contact.links.find(
    ({ label }) => label === "GitHub",
  );
  return (
    <div className="flex h-dvh flex-col">
      <main className="flex min-h-0 flex-1 justify-center sm:px-6 sm:pt-6 lg:px-10 lg:pt-10">
        <div className="h-full w-full max-w-5xl">
          {/* Decided at build time; the server still refuses questions if AI is switched off later. */}
          <Terminal
            aiEnabled={process.env.AI_ENABLED?.trim().toLowerCase() !== "false"}
            cvAvailable={cvConfig(process.env) !== undefined}
          />
        </div>
        <noscript>
          <p className="fixed inset-x-0 bottom-0 bg-term-chrome p-4 text-center">
            This terminal needs JavaScript to run commands.{" "}
            {github && (
              <a className="term-link" href={github.url}>
                My work is on GitHub.
              </a>
            )}
          </p>
        </noscript>
      </main>
      <footer className="shrink-0 py-1.5 text-center text-xs text-term-muted sm:py-2 lg:py-3">
        © 2026 Alex Jennings · Built by AJ
      </footer>
    </div>
  );
}
