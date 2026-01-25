import Image from "next/image";

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8 sm:p-20 font-sans">
      <main className="flex flex-col gap-12 items-center sm:items-start max-w-4xl w-full">
        {/* Hero Section */}
        <div className="w-full flex flex-col gap-6">
          <h1 className="text-6xl sm:text-8xl font-bold tracking-tighter text-um-white">
            BIG TONY
          </h1>
          <p className="text-xl sm:text-2xl text-um-turquoise font-mono">
            WhatsApp Agent powered by Wassist
          </p>
          <p className="text-lg text-gray-400 max-w-2xl">
            Handles community member management, membership verification, and demo submissions for the Unicorn Mafia.
          </p>
        </div>

        {/* Status Section */}
        <div className="w-full grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div className="border border-um-white/10 p-6 rounded-lg bg-white/5 backdrop-blur-sm">
            <h2 className="text-xl font-bold mb-4 text-um-purple flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-um-purple animate-pulse"></span>
              Production
            </h2>
            <a 
              href="https://wa.me/447488895960"
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-2xl text-um-white hover:text-um-purple transition-colors block w-fit"
            >
              +44 7488 895960
            </a>
            <p className="text-sm text-gray-500 mt-2">Available on WhatsApp</p>
          </div>

          <div className="border border-um-white/10 p-6 rounded-lg bg-white/5 backdrop-blur-sm">
            <h2 className="text-xl font-bold mb-4 text-um-blue">Capabilities</h2>
            <ul className="space-y-2 font-mono text-sm text-gray-300">
              <li className="flex items-center gap-2">
                <span className="text-um-blue">→</span> Member Verification
              </li>
              <li className="flex items-center gap-2">
                <span className="text-um-blue">→</span> Registration
              </li>
              <li className="flex items-center gap-2">
                <span className="text-um-blue">→</span> Demo Submissions
              </li>
            </ul>
          </div>
        </div>

        {/* Links Section */}
        <div className="flex gap-4 flex-wrap">
          <a
            href="https://github.com/unicorn-mafia/big-tony"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full border border-um-white/20 transition-colors flex items-center justify-center bg-um-white text-um-black gap-2 hover:bg-um-turquoise hover:border-transparent text-sm sm:text-base h-10 sm:h-12 px-4 sm:px-5 font-bold"
          >
            View Source
          </a>
          <a
            href="https://wassist.app"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full border border-um-white/20 transition-colors flex items-center justify-center hover:bg-white/10 text-um-white hover:border-um-white text-sm sm:text-base h-10 sm:h-12 px-4 sm:px-5"
          >
            Powered by Wassist
          </a>
        </div>
      </main>
      
      <footer className="mt-24 text-gray-600 text-sm font-mono">
        UNICORN MAFIA © 2026
      </footer>
    </div>
  );
}
