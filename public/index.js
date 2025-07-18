// Initialize Socket.io connection
const socket = io();

// Get canvas context for Chart.js
const ctx = document.getElementById('myChart').getContext('2d');

// Initialize chart data structure
const chartData = {
    labels: [],
    datasets: [{
        label: 'Yotta Balance',
        data: [],
        borderColor: 'rgb(75, 192, 192)',
        backgroundColor: 'rgba(75, 192, 192, 0.2)',
        borderWidth: 3,
        fill: false,
        tension: 0.1
    }]
};

// Chart configuration
const config = {
    type: 'line',
    data: chartData,
    options: {
        responsive: true,
        maintainAspectRatio: true,
        interaction: {
            intersect: false,
        },
        scales: {
            x: {
                display: true,
                title: {
                    display: true,
                    text: 'Time'
                }
            },
            y: {
                display: true,
                title: {
                    display: true,
                    text: 'Balance'
                }
            }
        },
        plugins: {
            legend: {
                display: true
            }
        },
        animation: {
            duration: 0 // Disable animations for real-time updates
        }
    }
};

// Create Chart.js instance
const myChart = new Chart(ctx, config);

// Maximum number of data points to display
const MAX_DATA_POINTS = 5000;

// Socket.io event listeners
socket.on('connect', () => {
    console.log('Connected to server');
    updateConnectionStatus('Connected');
});

socket.on('disconnect', () => {
    console.log('Disconnected from server');
    updateConnectionStatus('Disconnected');
});

socket.on('reconnect', () => {
    console.log('Reconnected to server');
    updateConnectionStatus('Reconnected');
});

// Listen for new data from the server
socket.on('newData', (data) => addDataToChart(data));
socket.on("bal", (bal) => updateBalance(bal));
socket.on("bet", (bet) => updateBet(bet));
socket.on("diff", (diff) => updateDiff(diff));
socket.on("status", (status) => updateRunning(status));

// Function to add single data point to chart
function addDataToChart(data) {
    const { timestamp, value, label } = data;

    // Create label from timestamp or use provided label
    const dataLabel = label || formatTimestamp(timestamp || Date.now());

    // Add new data point
    myChart.data.labels.push(dataLabel);
    myChart.data.datasets[0].data.push(value);

    // Remove oldest data point if we exceed maximum
    if (myChart.data.labels.length > MAX_DATA_POINTS) {
        myChart.data.labels.shift();
        myChart.data.datasets[0].data.shift();
    }

    // Update the chart
    myChart.update('none'); // 'none' mode for better performance
}

// Function to update chart with bulk data
function updateChartWithBulkData(dataArray) {
    // Clear existing data
    myChart.data.labels = [];
    myChart.data.datasets[0].data = [];

    // Add all data points
    dataArray.forEach(data => {
        const { timestamp, value, label } = data;
        const dataLabel = label || formatTimestamp(timestamp || Date.now());

        myChart.data.labels.push(dataLabel);
        myChart.data.datasets[0].data.push(value);
    });

    // Limit to maximum data points
    if (myChart.data.labels.length > MAX_DATA_POINTS) {
        myChart.data.labels = myChart.data.labels.slice(-MAX_DATA_POINTS);
        myChart.data.datasets[0].data = myChart.data.datasets[0].data.slice(-MAX_DATA_POINTS);
    }

    // Update the chart
    myChart.update();
}

// Function to reset chart
function resetChart() {
    myChart.data.labels = [];
    myChart.data.datasets[0].data = [];
    myChart.update();
}

// Utility function to format timestamp
function formatTimestamp(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString();
}

// Function to update connection status in UI
function updateConnectionStatus(status) {
    const statusElement = document.getElementById('connectionStatus');
    if (statusElement) {
        statusElement.textContent = `Status: ${status}`;
        statusElement.className = `status ${status.toLowerCase()}`;
    }
}

function updateBalance(bal) {
    const elem = document.getElementById('currentBalance');
    if (elem) {
        elem.textContent = `Current Balance: $${bal.toFixed(2)}`;
    }
}

function updateBet(bet) {
    const elem = document.getElementById('currentBet');
    if (elem) {
        elem.textContent = `Current Bet: $${bet.toFixed(2)}`;
    }
}

function updateDiff(diff) {
    const elem = document.getElementById('totalDifference');
    if (elem) {
        elem.textContent = `Total Win/Loss: $${diff.toFixed(2)}`;
    }
}

function updateRunning(run) {
    const elem = document.getElementById("runToggle");
    if (elem) {
        elem.checked = run;
    }
}

document.getElementById("runToggle").addEventListener("change", sendToggle);
function sendToggle(e) {
    let shouldRun = e.target.checked;
    console.log("Toggling: " + shouldRun)

    socket.emit("toggle", shouldRun);
}

// Error handling
socket.on('error', (error) => {
    console.error('Socket.io error:', error);
    updateConnectionStatus('Error');
});

// Optional: Handle window resize for responsive chart
window.addEventListener('resize', () => {
    myChart.resize();
});

// Export functions for potential external use
window.chartManager = {
    addData: addDataToChart,
    resetChart: resetChart,
    getChart: () => myChart
};