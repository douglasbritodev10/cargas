import { db, collection, addDoc, getDocs, doc, updateDoc, deleteDoc, getDoc } from './firebase.js';

let normaCount = 0;

const TIPOS_UNIFIZADOR = [
  "PALETE 1.00 X 1.60",
  "PALETE 1.60 X 1.60",
  "PALETE 1.60 X 1.60 SOBRA",
  "PALETE 1.60 X 1.60 - TOTAL"
];

window.adicionarNormaBloco = function(normaData = {}) {
  normaCount++;
  const container = document.getElementById('normas-container');
  const normaId = `norma-bloco-${normaCount}`;
  const volumesContainerId = `volumes-in-norma-${normaCount}`;

  let optionsUnificador = '';
  TIPOS_UNIFIZADOR.forEach(tipo => {
    const selected = (normaData.unificador === tipo) ? 'selected' : '';
    optionsUnificador += `<option value="${tipo}" ${selected}>${tipo}</option>`;
  });

  const div = document.createElement('div');
  div.className = 'card';
  div.style.border = '2px dashed #cbd5e1';
  div.style.background = '#f8fafc';
  div.style.marginBottom = '15px';
  div.id = normaId;
  div.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
      <h4 style="color: #0284c7; font-size: 0.9rem;">📦 Bloco de Norma de Paletização</h4>
      <button type="button" class="btn-remove" onclick="document.getElementById('${normaId}').remove()" style="padding: 2px 8px; height: 26px; font-size: 0.75rem;">Excluir Norma</button>
    </div>
    <div class="form-grid">
      <div class="field">
        <label>Unifizador</label>
        <select class="norma-unificador" required>${optionsUnificador}</select>
      </div>
      <div class="field">
        <label>Padrão</label>
        <select class="norma-padrao">
          <option value="SIM" ${normaData.padrao === 'SIM' ? 'selected' : ''}>SIM</option>
          <option value="NAO" ${normaData.padrao === 'NAO' ? 'selected' : ''}>NAO</option>
        </select>
      </div>
      <div class="field">
        <label>Lastro</label>
        <input type="number" class="norma-lastro" value="${normaData.lastro || 2}" min="1" required>
      </div>
      <div class="field">
        <label>Camadas</label>
        <input type="number" class="norma-camadas" value="${normaData.camadas || 4}" min="1" required>
      </div>
      <div class="field">
        <label>Qtd Jogos por Palete</label>
        <input type="number" class="norma-jogos" value="${normaData.jogosPorPalete || 10}" min="1" required>
      </div>
    </div>

    <h5 style="margin: 15px 0 5px 0; font-size: 0.85rem; color: #334155;">Volumes pertencentes a esta Norma:</h5>
    <div id="${volumesContainerId}"></div>
    <button type="button" class="btn-secondary" onclick="addVolumeEmNorma('${volumesContainerId}')" style="margin-top: 8px; font-size: 0.75rem; padding: 4px 10px;">+ Adicionar Volume nesta Norma</button>
  `;

  container.appendChild(div);
  
  if (normaData.volumes && normaData.volumes.length > 0) {
    normaData.volumes.forEach(v => addVolumeEmNorma(volumesContainerId, v));
  } else {
    addVolumeEmNorma(volumesContainerId);
  }
};

window.addVolumeEmNorma = function(containerId, vol = {}) {
  const container = document.getElementById(containerId);
  const volRowId = 'vol-item-' + Date.now() + Math.random().toString(36).substring(2, 5));
  
  const div = document.createElement('div');
  div.className = 'volume-row';
  div.id = volRowId;
  div.style.background = '#ffffff';
  div.style.marginBottom = '8px';
  div.innerHTML = `
    <input type="text" placeholder="Ex: 01/03" value="${vol.numero || ''}" class="vol-num" required>
    <input type="text" placeholder="Desc. (Ex: Vol 01/03 Lateral)" value="${vol.descricao || ''}" class="vol-desc" required>
    <input type="number" step="0.01" placeholder="Alt(m)" value="${vol.altura || ''}" class="vol-alt" required>
    <input type="number" step="0.01" placeholder="Larg(m)" value="${vol.largura || ''}" class="vol-larg" required>
    <input type="number" step="0.01" placeholder="Prof(m)" value="${vol.prof || ''}" class="vol-prof" required>
    <input type="number" step="0.1" placeholder="Peso(kg)" value="${vol.peso || ''}" class="vol-peso" required>
    <button type="button" class="btn-remove" onclick="document.getElementById('${volRowId}').remove()">X</button>
  `;
  container.appendChild(div);
};

document.getElementById('form-produto').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const normasBlocos = [];
  document.querySelectorAll('#normas-container > div').forEach(blocoCard => {
    const unificador = blocoCard.querySelector('.norma-unificador').value;
    const padrao = blocoCard.querySelector('.norma-padrao').value;
    const lastro = parseInt(blocoCard.querySelector('.norma-lastro').value) || 1;
    const camadas = parseInt(blocoCard.querySelector('.norma-camadas').value) || 1;
    const jogosPorPalete = parseInt(blocoCard.querySelector('.norma-jogos').value) || 1;

    const volumesDesteBloco = [];
    blocoCard.querySelectorAll('.volume-row').forEach(row => {
      volumesDesteBloco.push({
        numero: row.querySelector('.vol-num').value,
        descricao: row.querySelector('.vol-desc').value,
        altura: parseFloat(row.querySelector('.vol-alt').value) || 0,
        largura: parseFloat(row.querySelector('.vol-larg').value) || 0,
        prof: parseFloat(row.querySelector('.vol-prof').value) || 0,
        peso: parseFloat(row.querySelector('.vol-peso').value) || 0
      });
    });

    normasBlocos.push({
      unificador,
      padrao,
      lastro,
      camadas,
      jogosPorPalete,
      volumes: volumesDesteBloco
    });
  });

  if (normasBlocos.length === 0) return alert("Adicione pelo menos uma norma!");

  let todosVolumesGerais = [];
  normasBlocos.forEach(n => { todosVolumesGerais = todosVolumesGerais.concat(n.volumes); });

  const produtoData = {
    codigo: document.getElementById('prod-codigo').value,
    descricao: document.getElementById('prod-descricao').value,
    grade: document.getElementById('prod-grade').value,
    fornecedor: document.getElementById('prod-fornecedor').value,
    normasPaletizacao: normasBlocos,
    volumes: todosVolumesGerais
  };

  const id = document.getElementById('prod-id').value;
  if (id) {
    await updateDoc(doc(db, "produtos", id), produtoData);
    alert("Produto atualizado com sucesso!");
  } else {
    await addDoc(collection(db, "produtos"), produtoData);
    alert("Produto cadastrado com sucesso!");
  }

  resetFormProduto();
  carregarProdutos();
});

window.resetFormProduto = function() {
  document.getElementById('form-produto').reset();
  document.getElementById('prod-id').value = '';
  document.getElementById('normas-container').innerHTML = '';
  normaCount = 0;
  adicionarNormaBloco();
};

async function carregarProdutos() {
  const tbody = document.getElementById('lista-produtos');
  tbody.innerHTML = '';
  const querySnapshot = await getDocs(collection(db, "produtos"));
  querySnapshot.forEach((docSnap) => {
    const p = docSnap.data();
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${p.codigo}</td>
      <td>${p.descricao}</td>
      <td>${p.grade || '-'}</td>
      <td>${p.fornecedor}</td>
      <td>${p.normasPaletizacao ? p.normasPaletizacao.length : 0} norma(s) | ${p.volumes ? p.volumes.length : 0} vol(s)</td>
      <td>
        <button class="btn-secondary" onclick="editarProduto('${docSnap.id}')">Editar</button>
        <button class="btn-remove" style="padding:0 8px" onclick="deletarProduto('${docSnap.id}')">Excluir</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

window.editarProduto = async function(id) {
  const docSnap = await getDoc(doc(db, "produtos", id));
  if (docSnap.exists()) {
    const p = docSnap.data();
    document.getElementById('prod-id').value = id;
    document.getElementById('prod-codigo').value = p.codigo;
    document.getElementById('prod-descricao').value = p.descricao;
    document.getElementById('prod-grade').value = p.grade;
    document.getElementById('prod-fornecedor').value = p.fornecedor;

    document.getElementById('normas-container').innerHTML = '';
    normaCount = 0;

    if (p.normasPaletizacao && p.normasPaletizacao.length > 0) {
      p.normasPaletizacao.forEach(norma => adicionarNormaBloco(norma));
    } else {
      adicionarNormaBloco({ unificador: "PALETE 1.60 X 1.60", volumes: p.volumes || [] });
    }
  }
};

window.deletarProduto = async function(id) {
  if (confirm("Deseja realmente excluir este produto?")) {
    await deleteDoc(doc(db, "produtos", id));
    carregarProdutos();
  }
};

carregarProdutos();
adicionarNormaBloco();