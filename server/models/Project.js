const mongoose = require('mongoose');

const projectSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    repositoryUrl: { type: String, required: true, trim: true },
    name: String,
    description: String,
    analysis: { type: Object, default: {} },
    documents: { type: Object, default: {} }
  },
  { timestamps: true }
);

module.exports = mongoose.models.Project || mongoose.model('Project', projectSchema);
