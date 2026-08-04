import inventory from "./data/inventory";

function App() {
  return (
    <div>
      <h1>HomeHub Pantry Organizer</h1>

      <h2>Inventory</h2>

      {inventory.map((item) => (
        <p key={item.id}>
          {item.name}: {item.quantity} {item.unit}
        </p>
      ))}

    </div>
  );
}

export default App;