// src/shared/utils/ApiHealth.js
export const calculateApiHealth = (executionTime) => {
  if (executionTime < 100) {
    return "excellent";
  }
  if (executionTime < 300) {
    return "good";
  }
  if (executionTime < 500) {
    return "fair";
  }
  return "poor";
};
