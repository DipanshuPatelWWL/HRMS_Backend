// ================= hr.ai.controller.js =================

const UnansweredQ = require("../models/UnansweredQ");
const CompanyKB = require("../models/CompanyKB");


// GET ALL UNANSWERED QUESTIONS
const getUnansweredQuestions = async (req, res) => {
    try {
        const questions = await UnansweredQ.find({ status: "pending" })
            .sort({ count: -1, createdAt: -1 });

        res.json({ success: true, questions });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            success: false,
            message: "Failed to fetch unanswered questions",
        });
    }
};


// HR ANSWER QUESTION
const answerQuestion = async (req, res) => {
    try {
        const { answer } = req.body;

        const questionDoc = await UnansweredQ.findById(req.params.id);
        if (!questionDoc) {
            return res.status(404).json({ success: false, message: "Question not found" });
        }

        // Upsert into KB — safe even if question already exists
        await CompanyKB.findOneAndUpdate(
            { question: questionDoc.question },
            {
                $set: {
                    answer,
                    updatedBy: req.user._id,
                },
            },
            { upsert: true, new: true }
        );

        // Mark as answered — disappears from HR view automatically
        questionDoc.status = "answered";
        await questionDoc.save();

        res.json({ success: true, message: "Answer saved to Knowledge Base ✓" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Failed to save answer" });
    }
};


// DELETE UNANSWERED QUESTION
const deleteUnansweredQuestion = async (req, res) => {
    try {
        const questionDoc = await UnansweredQ.findById(req.params.id);

        if (!questionDoc) {
            return res.status(404).json({ success: false, message: "Question not found" });
        }

        await UnansweredQ.findByIdAndDelete(req.params.id);

        res.json({ success: true, message: "Question deleted successfully" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Failed to delete question" });
    }
};


module.exports = {
    getUnansweredQuestions,
    answerQuestion,
    deleteUnansweredQuestion,
};