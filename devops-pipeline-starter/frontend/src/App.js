import { useEffect, useState } from "react";
import { getTestMessage } from "./api/testApi";

function App() {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const loadData = async () => {
      try {
        const data = await getTestMessage();
        setMessage(data.message);
      } catch (err) {
        setError("Pipeline error: backend not reachable");
        console.error(err);
      }
    };

    loadData();
  }, []);

  return (
    <div style={{ textAlign: "center", marginTop: "50px" }}>
      <h1>React Express Pipeline Test</h1>

     
      {message && (
        <div>
          <h3>Backend Response</h3>
          <p>{message}</p>
        </div>
      )}

      {error && (
        <div>
          <h3>Error</h3>
          <p style={{ color: "red" }}>{error}</p>
        </div>
      )}
    </div>
  );
}

export default App;