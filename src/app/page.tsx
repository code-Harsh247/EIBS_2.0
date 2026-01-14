export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <div className="text-center">
        <h1 className="text-4xl font-bold mb-4">
          Liquid
        </h1>
        <p className="text-xl text-gray-600 mb-8">
          Enterprise Invoice Blockchain System
        </p>
        <p className="text-gray-500 mb-8">
          Secure invoice management with blockchain verification
        </p>
        <div className="space-x-4">
          <a
            href="/api/health"
            className="inline-block px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
          >
            Check API Health
          </a>
        </div>
      </div>
    </main>
  );
}
