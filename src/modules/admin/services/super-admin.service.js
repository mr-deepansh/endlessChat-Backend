// src/modules/admin/services/super-admin.service.js
import { User } from "../../users/models/user.model.js";
import { USER_ROLES } from "../../../shared/constants/app.constants.js";
import { ApiError } from "../../../shared/utils/ApiError.js";

export class SuperAdminService {
  // Create admin with validation
  static async createAdmin(adminData) {
    const { email, username, password, firstName, lastName, role = USER_ROLES.ADMIN } = adminData;

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [{ email: email.toLowerCase() }, { username: username.toLowerCase() }],
    });

    if (existingUser) {
      throw new ApiError(409, "User with this email or username already exists");
    }

    // Create admin
    const admin = await User.create({
      email: email.toLowerCase(),
      username: username.toLowerCase(),
      password,
      firstName,
      lastName,
      role,
      isActive: true,
    });

    return await User.findById(admin._id).select("-password -refreshToken -forgotPasswordToken");
  }

  // Get system statistics
  static async getSystemStats() {
    const stats = await User.aggregate([
      {
        $group: {
          _id: "$role",
          count: { $sum: 1 },
          active: { $sum: { $cond: ["$isActive", 1, 0] } },
        },
      },
    ]);

    const result = {
      total: 0,
      byRole: {},
      activeUsers: 0,
    };

    stats.forEach((stat) => {
      result.total += stat.count;
      result.activeUsers += stat.active;
      result.byRole[stat._id] = {
        total: stat.count,
        active: stat.active,
        inactive: stat.count - stat.active,
      };
    });

    return result;
  }

  // Validate role change
  static async validateRoleChange(userId, newRole, currentUserRole) {
    const user = await User.findById(userId);
    if (!user) {
      throw new ApiError(404, "User not found");
    }

    // Prevent demoting the last super admin
    if (user.role === USER_ROLES.SUPER_ADMIN && newRole !== USER_ROLES.SUPER_ADMIN) {
      const superAdminCount = await User.countDocuments({
        role: USER_ROLES.SUPER_ADMIN,
      });
      if (superAdminCount <= 1) {
        throw new ApiError(400, "Cannot demote the last super admin");
      }
    }

    return user;
  }

  // Get user activity summary
  static async getUserActivitySummary(timeframe = "30d") {
    const daysAgo = parseInt(timeframe.replace("d", ""));
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysAgo);

    const activity = await User.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
          },
          newUsers: { $sum: 1 },
          newAdmins: {
            $sum: {
              $cond: [{ $in: ["$role", [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN]] }, 1, 0],
            },
          },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    return activity;
  }
}
