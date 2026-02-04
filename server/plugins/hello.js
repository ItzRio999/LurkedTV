module.exports = function(app, services) {
    console.log("🚀 Plugin 'Hello' activé !");

    //route de test accessible sur http://localhost:3000/api/hello
    app.get('/api/hello', (req, res) => {
        res.json({ message: "Le système de plugin fonctionne !" });
    });
};