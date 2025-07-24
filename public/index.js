// Initialize Socket.io connection
const socket = io();

// Get canvas context for Chart.js
const ctx = document.getElementById('myChart').getContext('2d');

// Chart configuration
const config = {
    type: 'line',
    data: {
        labels: [],
        datasets: [{
            label: 'Yotta Balance',
            data: [],
            borderColor: 'rgb(69, 135, 233)',
            backgroundColor: 'rgb(69, 135, 233, 0.2)',
            borderWidth: 2,
            fill: true,
            tension: 0.4,
            pointRadius: 0
        }]
    },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
            intersect: false,
            mode: 'index',
        },
        scales: {
            x: {
                display: true,
                title: { display: false },
                ticks: { color: '#a0a0e0' },
                grid: { color: 'rgba(15, 52, 96, 0.5)' }
            },
            y: {
                display: true,
                title: { display: false },
                ticks: { color: '#a0a0e0' },
                grid: { color: 'rgba(15, 52, 96, 0.5)' }
            }
        },
        plugins: {
            legend: { display: false }
        },
        animation: {
            duration: 200 // Slight animation for smoother updates
        }
    }
};

const formatterUSD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2
});

// Create Chart.js instance
const myChart = new Chart(ctx, config);
const MAX_DATA_POINTS = 1000;

// Socket.io event listeners
socket.on('connect', () => updateConnectionStatus('Connected'));
socket.on('disconnect', () => updateConnectionStatus('Disconnected'));
socket.on('reconnect', () => updateConnectionStatus('Reconnected'));
socket.on('error', (error) => {
    console.error('Socket.io error:', error);
    updateConnectionStatus('Error');
});

// Listen for new data from the server
socket.on('newData', addDataToChart);
socket.on("bal", (bal) => updateUI('currentBalance', `${formatterUSD.format(bal)}`));
socket.on("bet", (bet) => updateUI('currentBet', `${formatterUSD.format(bet)}`));
socket.on("diff", updateDifference);
socket.on("status", updateRunningStatus);
socket.on("stats", updateStatistics);
socket.on("profitTargetReached", () => {
    const popup = document.getElementById("profitTargetPopup");
    if (popup) {
        popup.style.display = 'flex';
        setTimeout(() => popup.classList.add('active'), 10);
    }
});

socket.on("safetyLimitReached", () => {
    const popup = document.getElementById("safetyLimitPopup");
    if (popup) {
        popup.style.display = 'flex';
        setTimeout(() => popup.classList.add('active'), 10);
    }
});

socket.on("config", (config) => {
    updateConfigDisplay(config);
    const strategySelector = document.getElementById("strategySelector");
    if (strategySelector) {
        strategySelector.value = config.STRATEGY;
    }
});

socket.on("configReloaded", (message) => {
    alert(message);
});

// UI Update Functions
function updateUI(elementId, text) {
    const elem = document.getElementById(elementId)?.querySelector('.value');
    if (elem) elem.textContent = text;
}

function updateConnectionStatus(status) {
    const statusElement = document.getElementById('connectionStatus');
    if (statusElement) {
        statusElement.textContent = status;
        statusElement.className = `status ${status.toLowerCase()}`;
    }
}

function updateDifference(diff) {
    const elem = document.getElementById('totalDifference')?.querySelector('.value');
    if (elem) {
        const fixedDiff = diff.toFixed(2);
        elem.textContent = `${diff >= 0 ? '+' : ''}$${fixedDiff}`;
        elem.classList.toggle('gain', diff >= 0);
        elem.classList.toggle('loss', diff < 0);
    }
}

function updateConfigDisplay(config) {
    const container = document.getElementById('config-values');
    if (!container) return;

    container.innerHTML = ''; // Clear existing values

    for (const [key, value] of Object.entries(config)) {
        if (key === 'API_TOKEN' || key === 'DEVICE_ID') continue; // Don't display sensitive info

        const item = document.createElement('div');
        item.classList.add('stat-item');

        const label = document.createElement('span');
        label.classList.add('label');
        label.textContent = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()); // Format key for display

        const valueSpan = document.createElement('span');
        valueSpan.classList.add('value');
        valueSpan.textContent = value;

        item.appendChild(label);
        item.appendChild(valueSpan);
        container.appendChild(item);
    }
}

function updateRunningStatus(isRunning) {
    const toggle = document.getElementById("runToggle");
    const statusText = document.getElementById("runStatus");
    if (toggle) toggle.checked = isRunning;
    if (statusText) {
        statusText.innerText = isRunning ? 'Running' : 'Stopped';
        statusText.className = `bot-status ${isRunning ? 'running' : 'stopped'}`;
    }
}

function updateStatistics(stats) {
    const runtime = ((Date.now() - stats.startTime) / 1000 / 60).toFixed(1);
    const winRate = stats.totalBets > 0 ? ((stats.wins / stats.totalBets) * 100).toFixed(2) : 0;
    
    updateUI('runtime', `${runtime}m`);
    updateUI('winRate', `${winRate}%`);
    updateUI('totalBets', stats.totalBets);
    updateUI('wins', stats.wins);
    updateUI('losses', stats.losses);
    updateUI('totalWagered', `${formatterUSD.format(stats.totalWagered)}`);
    updateUI('maxWinStreak', stats.maxWinStreak);
    updateUI('maxLossStreak', stats.maxLossStreak);
    updateUI('largestWin', `${formatterUSD.format(stats.largestWin)}`);

    const currentStreakElem = document.getElementById('currentStreak')?.querySelector('.value');
    if (currentStreakElem) {
        const streak = stats.currentWinStreak > 0 ? `${stats.currentWinStreak}W` : `${stats.currentLossStreak}L`;
        currentStreakElem.textContent = streak;
        currentStreakElem.style.color = stats.currentWinStreak > 0 ? 'var(--gain-color)' : 'var(--loss-color)';
    }
}


// Chart Functions
function addDataToChart(data) {
    const { timestamp, value } = data;
    const label = new Date(timestamp || Date.now()).toLocaleTimeString();

    myChart.data.labels.push(label);
    myChart.data.datasets[0].data.push(value);

    if (myChart.data.labels.length > MAX_DATA_POINTS) {
        myChart.data.labels.shift();
        myChart.data.datasets[0].data.shift();
    }
    myChart.update('none');
}

// Event Listeners for Controls
document.getElementById("runToggle").addEventListener("change", (e) => {
    updateRunningStatus(e.target.checked);
    socket.emit("toggle", e.target.checked);
});

document.getElementById("resetStatsBtn").addEventListener("click", () => {
    if (confirm("Are you sure you want to reset all session statistics?")) {
        socket.emit("resetStats");
    }
});

document.getElementById("closePopupBtn").addEventListener("click", () => {
    const popup = document.getElementById("profitTargetPopup");
    if (popup) {
        popup.classList.remove('active');
        setTimeout(() => popup.style.display = 'none', 200);
    }
});

document.getElementById("closeSafetyPopupBtn").addEventListener("click", () => {
    const popup = document.getElementById("safetyLimitPopup");
    if (popup) {
        popup.classList.remove('active');
        setTimeout(() => popup.style.display = 'none', 200);
    }
});

document.getElementById("reloadConfigBtn").addEventListener("click", () => {
    socket.emit("reloadConfig");
});

document.getElementById("strategySelector").addEventListener("change", (e) => {
    socket.emit("setStrategy", e.target.value);
});

document.getElementById("manualStopLossBtn").addEventListener("click", () => {
    socket.emit("manualStopLoss");
});