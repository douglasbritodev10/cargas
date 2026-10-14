import { db, collection, addDoc, getDocs, doc, updateDoc, deleteDoc } from './firebase.js';

document.getElementById('form-veiculo').addEventListener('submit', async (e) => {
  e.preventDefault();
  const veiculoData = {
    tipo: document.getElementById('veic-tipo').value,
    nome: document.getElementById('veic-nome').value,
    comprimento: parseFloat(document.getElementById('veic-comprimento').value),
    largura: parseFloat(document.getElementById('veic-largura').value),
    altura: parseFloat(document.getElementById('veic-altura').value)
  };

  const id = document.getElementById('veic-id').value;
  if (id) {
    await updateDoc(doc(db, "veiculos", id), veiculoData);
    alert("Veículo atualizado com sucesso!");
  } else {
    await addDoc(collection(db, "veiculos"), veiculoData);
    alert("Veículo cadastrado com sucesso!");
  }

  document.getElementById('form-veiculo').reset();
  document.getElementById('veic-id').value = '';
  carregarVeiculos();
});

async function carregarVeiculos() {
  const tbody = document.getElementById('lista-veiculos');
  tbody.innerHTML = '';
  const querySnapshot = await getDocs(collection(db, "veiculos"));
  querySnapshot.forEach((docSnap) => {
    const v = docSnap.data();
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${v.tipo}</strong></td>
      <td>${v.nome}</td>
      <td>${v.comprimento}m x ${v.largura}m x ${v.altura}m</td>
      <td>
        <button class="btn-remove" style="padding:0 8px" onclick="deletarVeiculo('${docSnap.id}')">Excluir</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

window.deletarVeiculo = async function(id) {
  if (confirm("Excluir veículo?")) {
    await deleteDoc(doc(db, "veiculos", id));
    carregarVeiculos();
  }
};

carregarVeiculos();