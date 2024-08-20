const express = require('express');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Papa = require('papaparse');

const app = express();
const port = 3000;

app.use(express.json());

let savedFormat = [];
let sampleData = [];

// Fetch and store the saved format and sample data when the server starts
const fetchSavedFormat = async () => {
    try {
        const response = await axios.get('https://api.npoint.io/00f9d246508b5399e092');
        savedFormat = response.data.csvFormat.split(',');
        sampleData = response.data.csvFormat.split('\n')[1]; // Assuming the second line is the sample data
    } catch (error) {
        console.error('Error fetching saved format:', error);
    }
};

fetchSavedFormat();

// Function to format data using Gemini and saved format
async function formatData(unformattedData, prompt, modelName, apiKey) {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: modelName });

    try {
        // Send data and prompt to Gemini for processing
        const geminiPrompt = `Given the following unformatted data:\n${unformattedData}\nFormat this data into a structured CSV format as described below. Use the following column headers and ensure each entry aligns under the correct header based on the content:\nHeaders: ${savedFormat.join(", ")}\nExample Row: ${sampleData}\nPrompt: ${prompt}`;
        const geminiResult = await model.generateContent(geminiPrompt);
        const formattedData = geminiResult.response.text();

        // Additional post-processing if needed
        return postProcess(formattedData);
    } catch (error) {
        console.error('Error using Gemini:', error);
        throw error;
    }
}

// Function to adjust and align the returned data to the saved format
function postProcess(geminiData) {
    // Parsing and realigning data logic here
    const lines = geminiData.split('\n');
    const headers = savedFormat;
    const outputData = [headers.join(',')];

    lines.forEach(line => {
        if (line.trim()) {  // Ensuring not to process empty lines
            const values = line.split(',').map(value => value.trim());  // Assuming the output is comma-separated
            outputData.push(values.join(','));
        }
    });

    return outputData.join('\n');
}


// Server endpoint for processing user request
app.post('/format-data', async (req, res) => {
    const { data: unformattedData, prompt, modelName, apiKey } = req.body;

    if (!unformattedData || !prompt || !modelName || !apiKey) {
        return res.status(400).send('Missing data, prompt, or model name');
    }

    try {
        const formatted = await formatData(unformattedData, prompt, modelName, apiKey);
        res.send({ convertedData: formatted });
    } catch (error) {
        console.error('Error formatting data:', error);
        res.status(500).send('Error formatting data');
    }
});

app.listen(port, () => console.log(`Server listening on port ${port}`));
