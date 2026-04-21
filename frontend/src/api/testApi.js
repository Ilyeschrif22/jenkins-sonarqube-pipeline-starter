const API_URL = process.env.REACT_APP_API_URL;

export const getTestMessage = async () => {
  const res = await fetch(`${API_URL}/api/test`);

  if (!res.ok) {
    throw new Error("Failed to fetch");
  }

  return res.json();
};