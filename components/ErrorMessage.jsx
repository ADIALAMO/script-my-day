function ErrorMessage({ message }) {
  return (
    <div className="text-red-500 mt-4">
      Error: {message}
    </div>
  );
}

export default ErrorMessage;
