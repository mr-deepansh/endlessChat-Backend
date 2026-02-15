// src/modules/admin/services/queryBuilder.service.js

export class QueryBuilderService {
  buildUserMatchStage(filters = {}) {
    const matchStage = {};
    const { search, role, isActive, isVerified, createdAt } = filters;

    // Text search with indexing optimization
    if (search) {
      // Use MongoDB text search if available, otherwise regex
      matchStage.$or = [
        { username: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { firstName: { $regex: search, $options: "i" } },
        { lastName: { $regex: search, $options: "i" } },
      ];
    }

    // Exact match filters
    if (role) {
      matchStage.role = role;
    }
    if (isActive !== undefined) {
      matchStage.isActive = isActive;
    }
    if (isVerified !== undefined) {
      matchStage.isVerified = isVerified;
    }

    // Date range filter
    if (createdAt && Object.keys(createdAt).length > 0) {
      matchStage.createdAt = createdAt;
    }

    // Always exclude soft-deleted users if applicable
    matchStage.isDeleted = { $ne: true };

    return matchStage;
  }

  buildUserProjection(includeFields = [], excludeFields = []) {
    const defaultExclude = ["password", "refreshToken", "__v"];
    const projection = {};

    // Always exclude sensitive fields
    defaultExclude.concat(excludeFields).forEach((field) => {
      projection[field] = 0;
    });

    // Include specific fields if provided
    if (includeFields.length > 0) {
      // Reset projection and include only specified fields
      Object.keys(projection).forEach((key) => delete projection[key]);
      includeFields.forEach((field) => {
        projection[field] = 1;
      });
      // Still exclude sensitive fields
      defaultExclude.forEach((field) => {
        projection[field] = 0;
      });
    }

    return projection;
  }

  buildUserListPipeline({ filters, pagination, sort, includeFields, excludeFields }) {
    const pipeline = [];

    // Match stage
    const matchStage = this.buildUserMatchStage(filters);
    pipeline.push({ $match: matchStage });

    // Add computed fields for better sorting/filtering
    pipeline.push({
      $addFields: {
        fullName: {
          $concat: [{ $ifNull: ["$firstName", ""] }, " ", { $ifNull: ["$lastName", ""] }],
        },
        daysSinceCreated: {
          $divide: [
            { $subtract: [new Date(), "$createdAt"] },
            86400000, // milliseconds in a day
          ],
        },
      },
    });

    // Project fields
    pipeline.push({
      $project: this.buildUserProjection(includeFields, excludeFields),
    });

    // Sort and pagination with facet for performance
    const skip = (pagination.page - 1) * pagination.limit;
    pipeline.push({
      $facet: {
        data: [{ $sort: sort }, { $skip: skip }, { $limit: pagination.limit }],
        count: [{ $count: "total" }],
        metadata: [
          {
            $group: {
              _id: null,
              avgDaysSinceCreated: { $avg: "$daysSinceCreated" },
              totalActive: {
                $sum: { $cond: [{ $eq: ["$isActive", true] }, 1, 0] },
              },
              totalVerified: {
                $sum: { $cond: [{ $eq: ["$isVerified", true] }, 1, 0] },
              },
            },
          },
        ],
      },
    });

    return pipeline;
  }

  buildAnalyticsPipeline(dateRange = null) {
    const pipeline = [];

    // Match stage with date filter if provided
    const matchStage = { isDeleted: { $ne: true } };
    if (dateRange) {
      matchStage.createdAt = dateRange;
    }
    pipeline.push({ $match: matchStage });

    // Group by various dimensions
    pipeline.push({
      $facet: {
        totalStats: [
          {
            $group: {
              _id: null,
              totalUsers: { $sum: 1 },
              activeUsers: {
                $sum: { $cond: [{ $eq: ["$isActive", true] }, 1, 0] },
              },
              adminUsers: {
                $sum: { $cond: [{ $eq: ["$role", "admin"] }, 1, 0] },
              },
            },
          },
        ],
        roleDistribution: [
          {
            $group: {
              _id: "$role",
              count: { $sum: 1 },
            },
          },
        ],
        monthlyGrowth: [
          {
            $group: {
              _id: {
                year: { $year: "$createdAt" },
                month: { $month: "$createdAt" },
              },
              count: { $sum: 1 },
            },
          },
          { $sort: { "_id.year": -1, "_id.month": -1 } },
          { $limit: 12 },
        ],
        dailyGrowth: [
          {
            $match: {
              createdAt: {
                $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
              },
            },
          },
          {
            $group: {
              _id: {
                year: { $year: "$createdAt" },
                month: { $month: "$createdAt" },
                day: { $dayOfMonth: "$createdAt" },
              },
              count: { $sum: 1 },
            },
          },
          { $sort: { "_id.year": -1, "_id.month": -1, "_id.day": -1 } },
        ],
      },
    });

    return pipeline;
  }
}
