export default function DashboardLoading() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <div className="mb-6 animate-pulse">
        <div className="h-8 bg-gray-700 rounded w-1/3 mb-2" />
        <div className="h-4 bg-gray-700 rounded w-1/4" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className={`animate-pulse ${i === 1 || i === 4 ? 'md:col-span-2' : ''}`}>
            <div className="bg-card rounded-xl border p-6 h-64">
              <div className="h-6 bg-gray-700 rounded w-1/3 mb-4" />
              <div className="h-12 bg-gray-700 rounded w-1/2 mb-4" />
              <div className="space-y-2">
                <div className="h-4 bg-gray-700 rounded" />
                <div className="h-4 bg-gray-700 rounded w-5/6" />
                <div className="h-4 bg-gray-700 rounded w-4/6" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
