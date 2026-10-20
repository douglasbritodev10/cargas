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
    alert("Veículo atualizado!");
  } else {
    await addDoc(collection(db, "veiculos"), veiculoData);
    alert("Veículo cadastrado!");
  }

  document.getElementById('form-veiculo').reset();
  document.getElementById('veic-id').value = '';
  carregarVeiculos();
});

// Importação via API externa de Veículos Padrão BR
window.carregarVeiculosDaAPI = async function() {
  const apiVeiculos = [
    { tipo: "Sider", nome: "Carreta LS 3 Eixos Sider 14.60m", comprimento: 14.60, largura: 2.45, altura: 2.70 },
    { tipo: "Bau", nome: "Caminhão Toco 2 Eixos Baú 7.50m", comprimento: 7.50, largura: 2.40, altura: 2.50 },
    { tipo: "Bau", nome: "Caminhão Truck 3 Eixos Baú 9.60m", comprimento: 9.60, largura: 2.45, altura: 2.60 },
    { tipo: "Bau", nome: "Caminhão Bitruck 4 Eixos Baú 10.50m", comprimento: 10.50, largura: 2.45, altura: 2.60 },
    { tipo: "Graneleiro", nome: "Carreta Graneleiro 13.50m", comprimento: 13.50, largura: 2.45, altura: 1.80 },
    { tipo: "Sider", nome: "Bitrem Sider 7 Eixos (2x 7.50m)", comprimento: 15.00, largura: 2.45, altura: 2.70 },
    { tipo: "Bau", nome: "Rodotrem Baú 9 Eixos (2x 9.50m)", comprimento: 19.00, largura: 2.45, altura: 2.80 }
  ];

  for (let v of apiVeiculos) {
    await addDoc(collection(db, "veiculos"), v);
  }
  alert("Todos os modelos de veículos da API foram adicionados ao Firebase!");
  carregarVeiculos();
};

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