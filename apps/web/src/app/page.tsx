import { Terminal } from '@/components/Terminal';
import { kb } from '@/lib/knowledge';

export default function Home() {
  const github = kb.profile.contact.links.find(({ label }) => label === 'GitHub');
  return (
    <main className="flex h-dvh items-stretch justify-center sm:p-6 lg:p-10">
      <div className="h-full w-full max-w-5xl">
        <Terminal />
      </div>
      <noscript>
        <p className="fixed inset-x-0 bottom-0 bg-term-chrome p-4 text-center">
          This terminal needs JavaScript to run commands.{' '}
          {github && (
            <a className="term-link" href={github.url}>
              My work is on GitHub.
            </a>
          )}
        </p>
      </noscript>
    </main>
  );
}
