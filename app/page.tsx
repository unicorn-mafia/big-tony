import Image from "next/image";

export default function Home() {
  return (
    <div className="min-h-screen bg-um-white text-um-black font-sans selection:bg-um-turquoise selection:text-um-black">
      <div className="max-w-screen-xl mx-auto px-6 py-12 sm:py-24">
        {/* Header / Hero */}
        <header className="mb-24">
          <Image
            src="/logo.svg"
            alt="Unicorn Mafia Logo"
            width={80}
            height={80}
            className="mb-8"
          />
          <h1 className="text-7xl sm:text-9xl font-bold tracking-tighter mb-6">
            BIG TONY
          </h1>
          <p className="font-mono text-gray-600 text-lg sm:text-xl border-l-2 border-um-turquoise pl-4">
            Community WhatsApp Agent / Powered by Wassist / v1.0
          </p>
        </header>

        {/* Grid Content */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-16 border-t border-um-black/10 pt-16">
          
          {/* Col 1: Status */}
          <div className="flex flex-col items-start">
            <h2 className="font-mono text-xs text-gray-400 mb-8 uppercase tracking-widest">
              // SYSTEM_STATUS
            </h2>
            <div className="flex items-center gap-3 mb-6">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-um-blue opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-um-blue"></span>
              </span>
              <span className="font-bold text-um-blue tracking-wide">OPERATIONAL</span>
            </div>
            <a 
              href="https://wa.me/447488895960"
              target="_blank"
              rel="noopener noreferrer"
              className="text-3xl sm:text-5xl font-mono hover:text-um-blue transition-colors border-b-2 border-transparent hover:border-um-blue pb-1"
            >
              +44 7488 895960
            </a>
            <p className="font-mono text-sm text-gray-500 mt-4">
              [ DIRECT_UPLINK ]
            </p>
          </div>

          {/* Col 2: Capabilities */}
          <div>
            <h2 className="font-mono text-xs text-gray-400 mb-8 uppercase tracking-widest">
              // CAPABILITIES
            </h2>
            <ul className="space-y-6 font-mono text-lg">
              <li className="flex items-center gap-4 group">
                <span className="text-um-blue opacity-50 group-hover:opacity-100 transition-opacity">01</span>
                <span className="border-l-2 border-um-black/10 pl-4 group-hover:border-um-blue transition-colors">
                  Member Verification
                </span>
              </li>
              <li className="flex items-center gap-4 group">
                <span className="text-um-blue opacity-50 group-hover:opacity-100 transition-opacity">02</span>
                <span className="border-l-2 border-um-black/10 pl-4 group-hover:border-um-blue transition-colors">
                  Registration Protocols
                </span>
              </li>
              <li className="flex items-center gap-4 group">
                <span className="text-um-blue opacity-50 group-hover:opacity-100 transition-opacity">03</span>
                <span className="border-l-2 border-um-black/10 pl-4 group-hover:border-um-blue transition-colors">
                  Demo Submissions
                </span>
              </li>
            </ul>
          </div>
        </div>

        {/* Footer / Links */}
        <div className="mt-24 pt-12 border-t border-um-black/10 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 font-mono text-xs sm:text-sm text-gray-500">
          <div>
            UNICORN MAFIA © 2026
          </div>
          <div className="flex gap-8">
            <a 
              href="https://github.com/unicorn-mafia/big-tony"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-um-black transition-colors flex items-center gap-2"
            >
              <span className="text-um-red">→</span> SOURCE_CODE
            </a>
            <a 
              href="https://wassist.app"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-um-black transition-colors flex items-center gap-2"
            >
              <span className="text-um-red">→</span> WASSIST_PLATFORM
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
