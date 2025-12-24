function LoadingIndicator() {
  return (
    <div className="text-blue-500 mt-4">
      <svg className="animate-spin -ml-1 mr-2 h-5 w-5 text-blue-500" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 010 16zm1-6v2h2v-2h-2zm-3 0v2h2v-2h-2z" />
      </svg>
      Loading...
    </div>
  );
}

export default LoadingIndicator;
