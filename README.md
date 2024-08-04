# AdMob Stratosphere

AdMob Stratosphere is an advanced tool that automates the creation and management of AdMob ad units and mediation groups, synchronizing them with Firebase Remote Config. By implementing multiple eCPM floor techniques, it aims to significantly boost ad revenue.

## Key Features

- Automatic creation of ad units with multiple eCPM floors
- Intelligent mediation group management
- Seamless synchronization with Firebase Remote Config
- Support for multiple ad formats (Interstitial, Rewarded, Banner, etc.)
- Compatible with both Node.js and Bun runtimes

## How eCPM Floors Boost Revenue

Understanding the mechanics of eCPM floors and auction types is crucial for maximizing ad revenue:

### Second-Price Auctions

In a second-price auction, the winning bidder pays the price of the second-highest bid. Here's how eCPM floors can help:

1. **Preventing Undervaluation**: By setting a floor, you ensure that your ad inventory isn't sold for less than its perceived value.
2. **Encouraging Higher Bids**: Bidders may increase their bids to surpass the floor and ensure they win the auction.
3. **Capturing True Value**: If the highest bid is significantly above the second-highest, a well-placed floor can capture more of that value.

### First-Price Auctions

In a first-price auction, the winning bidder pays exactly what they bid. eCPM floors are beneficial here because:

1. **Setting Minimum Acceptable Prices**: Floors directly establish the minimum price you're willing to accept for your inventory.
2. **Simplifying Bidding Strategies**: Advertisers know they need to bid above the floor to have a chance, potentially leading to higher bids.

### Multiple eCPM Floors Strategy

AdMob Stratosphere implements a multiple eCPM floors strategy, which can boost revenue by:

1. **Capturing High-Value Opportunities**: Higher floors capture high-value impressions when demand is strong.
2. **Maintaining Fill Rates**: Lower floors ensure a baseline fill rate, maintaining overall revenue.
3. **Adapting to Market Conditions**: Different floors allow your app to adapt to varying market conditions and user segments.
4. **Gathering Pricing Data**: Multiple floors provide insights into the true value of your inventory across different scenarios.

## Implementation Strategy for Developers

To maximize the benefits of AdMob Stratosphere's multiple eCPM floors, consider the following implementation strategy:

1. **Prioritized Loading**:
   - Start by attempting to load ads with the highest eCPM floor.
   - If unsuccessful, progressively try lower floors.
   - Example pseudocode:
     ```python
     floors = [10.0, 5.0, 2.0, 1.0, 0.5]
     for floor in floors:
         ad = try_load_ad(floor)
         if ad:
             display(ad)
             break
     ```

2. **Parallel Loading with Timeout**:
   - Initiate ad requests for multiple floors simultaneously.
   - Set a timeout for high-floor requests.
   - Display the highest-value ad that loads within the timeout.
   - Example pseudocode:
     ```python
     ads = parallel_load_ads([10.0, 5.0, 2.0, 1.0, 0.5])
     wait_for_timeout(3000)  # 3 seconds
     best_ad = select_highest_value_loaded_ad(ads)
     if best_ad:
         display(best_ad)
     else:
         wait_for_any_ad(ads)
     ```

3. **Dynamic Floor Adjustment**:
   - Use historical data to adjust floor values.
   - Increase floors during high-demand periods.
   - Lower floors when fill rates drop below targets.

4. **User Segmentation**:
   - Apply different floor strategies based on user segments.
   - Higher floors for users in high-value demographics or geos.
   - Lower floors for new users or less engaged segments.

5. **Waterfall Optimization**:
   - Use AdMob Stratosphere to create a waterfall of ad networks.
   - Order networks by historical eCPM performance.
   - Adjust waterfall based on real-time performance data.

By implementing these strategies, you can maximize the effectiveness of the multiple eCPM floors created by AdMob Stratosphere, potentially leading to significant revenue increases.

## Revenue Improvement Potential

While results can vary widely based on app category, user base, and market conditions, apps implementing advanced eCPM floor strategies have reported:

- Overall revenue increases of 15-25%
- eCPM improvements of 20-30% for high-value ad formats like interstitials and rewarded videos
- Fill rate optimizations leading to 5-10% more filled requests
- Up to 40% increase in high-value impressions (top 10% eCPM range)

Note: These figures are general industry observations and not guaranteed results. Your specific outcomes may differ.

## Prerequisites

- Node.js (v14 or later) or Bun runtime
- AdMob account
- Firebase project
- Basic understanding of AdMob and mediation concepts

## Installation

1. Clone the repository:
   ```
   git clone https://github.com/yourusername/admob-stratosphere.git
   cd admob-stratosphere
   ```

2. Install dependencies:
   
   For Node.js:
   ```
   npm install
   ```
   
   For Bun:
   ```
   bun install
   ```

3. Create a `config.yml` file in the project root with your app configurations. See `config.example.yml` for reference.

## Configuration

Create a `config.yml` file with the following structure:

```yaml
default:
  ecpmFloors:
    - 1000
    - 500
    - 300
    - 100
    - 50
    - 30
    - 10
    - 5
    - 3
    - 1

apps:
  your-app-id-1:
    adSources:
      meta:
        placements:
          default:
            interstitial:
              placementId: "your-meta-interstitial-placement-id"
            rewarded:
              placementId: "your-meta-rewarded-placement-id"
      mintegral:
        appId: "your-mintegral-app-id"
        appKey: "your-mintegral-app-key"
        placements:
          default:
            interstitial:
              placementId: "your-mintegral-interstitial-placement-id"
              adUnitId: "your-mintegral-interstitial-adunit-id"
            rewarded:
              placementId: "your-mintegral-rewarded-placement-id"
              adUnitId: "your-mintegral-rewarded-adunit-id"
      # ... other ad sources
  
  your-app-id-2:
    # ... configuration for another app

# ... more apps
```

Adjust the `ecpmFloors` values and add all relevant ad sources for each app.

## Usage

AdMob Stratosphere supports two main actions: `sync` and `list`.

### Listing available apps

To list all available apps in your AdMob account:

For Node.js:
```
npm run start list
```

For Bun:
```
bun run index.ts list
```

### Syncing ad units and mediation groups

To synchronize ad units and mediation groups for all configured apps:

For Node.js:
```
npm run start sync
```

For Bun:
```
bun run index.ts sync
```

To sync a specific app:

For Node.js:
```
npm run start sync <app-id>
```

For Bun:
```
bun run index.ts sync <app-id>
```

### Options

- `-c, --config`: Specify a custom path for the configuration file (default: `config.yml`)
- `-h, --help`: Show help message

## Best Practices

1. Start with a wide range of eCPM floors to capture various bid levels.
2. Monitor performance and adjust floors based on your app's specific performance.
3. Implement advanced loading strategies as outlined in the "Implementation Strategy for Developers" section.
4. Regularly review and update your configuration to ensure optimal performance.
5. Use A/B testing to fine-tune your eCPM floor strategy for each app and ad format.
6. Pay attention to user experience metrics alongside revenue to ensure a balanced approach.

## Security Note

AdMob Stratosphere requires authentication with your AdMob and Firebase accounts. Ensure that you keep your authentication tokens and configuration files secure and never share them publicly.

## Contributing

Contributions to AdMob Stratosphere are welcome! Please feel free to submit a Pull Request.

## License

AdMob Stratosphere is licensed under the MIT License.